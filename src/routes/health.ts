import { Hono } from 'hono'
import { prisma } from '../db/prisma'
import type { CurrentUser } from '../middleware/auth'

export const health = new Hono<{ Variables: { currentUser: CurrentUser } }>()

health.get('/', async (c) => {
  // Optional connectivity check to ensure DB responds.
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (error) {
    console.error('Health check failed', error)
    return c.json({ status: 'error', details: 'database_unreachable' }, 500)
  }

  return c.json({ status: 'ok' })
})
