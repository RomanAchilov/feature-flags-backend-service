import { FeatureEnvironment, FeatureFlagAuditAction, FeatureFlagType } from '@prisma/client'
import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import type { CurrentUser } from '../middleware/auth'
import {
  createFlag,
  deleteFlagByKey,
  getFlagByKey,
  listFlags,
  updateFlagByKey
} from '../repositories/featureFlagRepository'
import {
  logFlagChange,
  getAuditLogForFlag
} from '../repositories/featureFlagAuditRepository'

const EnvironmentConfigSchema = z.object({
  environment: z.nativeEnum(FeatureEnvironment),
  enabled: z.boolean().optional(),
  rolloutPercentage: z.number().min(0).max(100).nullable().optional(),
  forceEnabled: z.boolean().nullable().optional(),
  forceDisabled: z.boolean().nullable().optional()
})

const UserTargetSchema = z.object({
  environment: z.nativeEnum(FeatureEnvironment),
  userId: z.string().min(1),
  include: z.boolean()
})

const CreateFlagSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  type: z.nativeEnum(FeatureFlagType).optional(),
  environments: z.array(EnvironmentConfigSchema).optional(),
  userTargets: z.array(UserTargetSchema).optional()
})

const UpdateFlagSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  type: z.nativeEnum(FeatureFlagType).optional(),
  environments: z.array(EnvironmentConfigSchema).optional(),
  userTargets: z.array(UserTargetSchema).optional()
})

export const flagsRoute = new Hono<{ Variables: { currentUser: CurrentUser } }>()

flagsRoute.get('/', async (c) => {
  const environment = c.req.query('environment')
  const search = c.req.query('search') ?? undefined
  const tag = c.req.query('tag') ?? undefined
  const page = Number.parseInt(c.req.query('page') ?? '1', 10)
  const pageSize = Number.parseInt(c.req.query('pageSize') ?? '20', 10)

  let envFilter: FeatureEnvironment | undefined
  if (environment) {
    if (!Object.values(FeatureEnvironment).includes(environment as FeatureEnvironment)) {
      return c.json({ error: { code: 'bad_request', message: 'Invalid environment' } }, 400)
    }
    envFilter = environment as FeatureEnvironment
  }

  const skip = page > 0 ? (page - 1) * pageSize : 0
  const take = pageSize

  try {
    const flags = await listFlags({
      environment: envFilter,
      search,
      tag,
      skip,
      take
    })
    return c.json({ data: flags })
  } catch (error) {
    console.error('Failed to list flags', error)
    return c.json({ error: { code: 'internal_error', message: 'Failed to list flags' } }, 500)
  }
})

flagsRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = CreateFlagSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'bad_request', message: 'Invalid body', details: parsed.error.flatten() } },
      400
    )
  }

  const currentUser = c.get('currentUser')

  try {
    const created = await createFlag(parsed.data)

    if (parsed.data.userTargets && parsed.data.userTargets.length > 0) {
      await upsertUserTargets(created.id, parsed.data.userTargets)
    }

    await logFlagChange({
      flagId: created.id,
      action: FeatureFlagAuditAction.create,
      changedBy: currentUser.id ?? 'system',
      before: null,
      after: created
    })

    const full = await fetchFlagWithRelations(created.key)
    return c.json({ data: full }, 201)
  } catch (error) {
    console.error('Failed to create flag', error)
    return c.json(
      { error: { code: 'internal_error', message: 'Failed to create flag' } },
      500
    )
  }
})

flagsRoute.get('/:key', async (c) => {
  const { key } = c.req.param()
  try {
    const flag = await fetchFlagWithRelations(key)
    if (!flag) {
      return c.json({ error: { code: 'not_found', message: 'Flag not found' } }, 404)
    }
    return c.json({ data: flag })
  } catch (error) {
    console.error('Failed to get flag', error)
    return c.json({ error: { code: 'internal_error', message: 'Failed to get flag' } }, 500)
  }
})

flagsRoute.get('/:key/audit', async (c) => {
  const { key } = c.req.param()
  const pageParam = c.req.query('page') ?? '1'
  const pageSizeParam = c.req.query('pageSize') ?? '20'

  const paginationParsed = z
    .object({
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().positive().max(200).default(20)
    })
    .safeParse({ page: pageParam, pageSize: pageSizeParam })

  if (!paginationParsed.success) {
    return c.json(
      { error: { code: 'bad_request', message: 'Invalid pagination', details: paginationParsed.error.flatten() } },
      400
    )
  }

  const { page, pageSize } = paginationParsed.data
  const skip = (page - 1) * pageSize
  const take = pageSize

  try {
    const flag = await getFlagByKey(key)
    if (!flag) {
      return c.json({ error: { code: 'not_found', message: 'Flag not found' } }, 404)
    }

    const [items, total] = await Promise.all([
      getAuditLogForFlag(flag.id, { skip, take }),
      prisma.featureFlagAuditLog.count({ where: { flagId: flag.id } })
    ])

    return c.json({
      data: items,
      page,
      pageSize,
      total
    })
  } catch (error) {
    console.error('Failed to get audit log', error)
    return c.json(
      { error: { code: 'internal_error', message: 'Failed to get audit log' } },
      500
    )
  }
})

flagsRoute.patch('/:key', async (c) => {
  const { key } = c.req.param()
  const body = await c.req.json().catch(() => null)
  const parsed = UpdateFlagSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'bad_request', message: 'Invalid body', details: parsed.error.flatten() } },
      400
    )
  }

  const currentUser = c.get('currentUser')

  try {
    const before = await fetchFlagWithRelations(key)
    if (!before) {
      return c.json({ error: { code: 'not_found', message: 'Flag not found' } }, 404)
    }

    const updated = await updateFlagByKey(key, parsed.data)
    if (!updated) {
      return c.json({ error: { code: 'not_found', message: 'Flag not found' } }, 404)
    }

    if (parsed.data.userTargets) {
      await replaceUserTargets(updated.id, parsed.data.userTargets)
    }

    const after = await fetchFlagWithRelations(key)

    await logFlagChange({
      flagId: updated.id,
      action: FeatureFlagAuditAction.update,
      changedBy: currentUser.id ?? 'system',
      before,
      after
    })

    return c.json({ data: after })
  } catch (error) {
    console.error('Failed to update flag', error)
    return c.json({ error: { code: 'internal_error', message: 'Failed to update flag' } }, 500)
  }
})

flagsRoute.delete('/:key', async (c) => {
  const { key } = c.req.param()
  const currentUser = c.get('currentUser')

  try {
    const existing = await fetchFlagWithRelations(key)
    if (!existing) {
      return c.json({ error: { code: 'not_found', message: 'Flag not found' } }, 404)
    }

    const deleted = await deleteFlagByKey(key)
    if (!deleted) {
      return c.json({ error: { code: 'not_found', message: 'Flag not found' } }, 404)
    }

    await logFlagChange({
      flagId: existing.id,
      action: FeatureFlagAuditAction.delete,
      changedBy: currentUser.id ?? 'system',
      before: existing,
      after: null
    })

    // Soft delete keeps data for audit; consumers should ignore flags with deletedAt set.
    return c.json({ data: { deleted: true } })
  } catch (error) {
    console.error('Failed to delete flag', error)
    return c.json({ error: { code: 'internal_error', message: 'Failed to delete flag' } }, 500)
  }
})

const fetchFlagWithRelations = (key: string) => {
  return prisma.featureFlag.findFirst({
    where: { key, deletedAt: null },
    include: {
      environments: {
        include: {
          userTargets: true
        }
      },
      auditLogs: {
        orderBy: { timestamp: 'desc' },
        take: 5
      }
    }
  })
}

const upsertUserTargets = async (
  flagId: string,
  userTargets: z.infer<typeof UserTargetSchema>[]
) => {
  const envs = await prisma.featureFlagEnvironment.findMany({
    where: { flagId }
  })
  const envMap = new Map(envs.map((env) => [env.environment, env.id]))

  const targetsToCreate = userTargets
    .map((target) => {
      const envId = envMap.get(target.environment)
      if (!envId) return null
      return {
        flagEnvironmentId: envId,
        userId: target.userId,
        include: target.include
      }
    })
    .filter(Boolean) as { flagEnvironmentId: string; userId: string; include: boolean }[]

  if (targetsToCreate.length === 0) return

  await prisma.featureFlagUserTarget.createMany({
    data: targetsToCreate,
    skipDuplicates: true
  })
}

const replaceUserTargets = async (
  flagId: string,
  userTargets: z.infer<typeof UserTargetSchema>[]
) => {
  const envs = await prisma.featureFlagEnvironment.findMany({
    where: { flagId }
  })
  const envMap = new Map(envs.map((env) => [env.environment, env.id]))
  const validEnvIds = Array.from(envMap.values())

  // Replace all targets for the flag (per environment) with provided set to keep state in sync.
  await prisma.$transaction([
    prisma.featureFlagUserTarget.deleteMany({
      where: { flagEnvironmentId: { in: validEnvIds } }
    }),
    prisma.featureFlagUserTarget.createMany({
      data: userTargets
        .map((target) => {
          const envId = envMap.get(target.environment)
          if (!envId) return null
          return {
            flagEnvironmentId: envId,
            userId: target.userId,
            include: target.include
          }
        })
        .filter(Boolean) as { flagEnvironmentId: string; userId: string; include: boolean }[],
      skipDuplicates: true
    })
  ])
}
