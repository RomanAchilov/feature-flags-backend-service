import type { FeatureFlagAuditAction, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'

export const logFlagChange = async (params: {
  flagId: string
  action: FeatureFlagAuditAction
  changedBy: string
  before: unknown
  after: unknown
}) => {
  // Записывает снимок изменений по флагу; может бросить Prisma ошибки, если flagId не существует.
  return prisma.featureFlagAuditLog.create({
    data: {
      flagId: params.flagId,
      action: params.action,
      changedBy: params.changedBy,
      before: params.before as Prisma.InputJsonValue,
      after: params.after as Prisma.InputJsonValue
    }
  })
}

export const getAuditLogForFlag = async (
  flagId: string,
  options?: { skip?: number; take?: number }
) => {
  // Возвращает историю изменений для флага; может бросить Prisma ошибки при неверных пагинационных параметрах.
  return prisma.featureFlagAuditLog.findMany({
    where: { flagId },
    orderBy: { timestamp: 'desc' },
    skip: options?.skip,
    take: options?.take
  })
}
