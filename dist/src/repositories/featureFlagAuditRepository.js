import { prisma } from "../db/prisma";
export const logFlagChange = async (params) => {
	// Записывает снимок изменений по флагу; может бросить Prisma ошибки, если flagId не существует.
	return prisma.featureFlagAuditLog.create({
		data: {
			flagId: params.flagId,
			action: params.action,
			changedBy: params.changedBy,
			before: params.before,
			after: params.after,
		},
	});
};
export const getAuditLogForFlag = async (flagId, options) => {
	// Возвращает историю изменений для флага; может бросить Prisma ошибки при неверных пагинационных параметрах.
	return prisma.featureFlagAuditLog.findMany({
		where: { flagId },
		orderBy: { timestamp: "desc" },
		skip: options?.skip,
		take: options?.take,
	});
};
