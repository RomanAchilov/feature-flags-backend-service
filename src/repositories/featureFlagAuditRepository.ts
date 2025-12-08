import type { FeatureFlagAuditAction, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;

export const logFlagChange = async (
	params: {
		flagId: string;
		action: FeatureFlagAuditAction;
		changedBy: string;
		before: unknown;
		after: unknown;
	},
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;

	return client.featureFlagAuditLog.create({
		data: {
			flagId: params.flagId,
			action: params.action,
			changedBy: params.changedBy,
			before: params.before as Prisma.InputJsonValue,
			after: params.after as Prisma.InputJsonValue,
		},
	});
};

export const getAuditLogForFlag = async (
	flagId: string,
	options?: { skip?: number; take?: number },
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;

	return client.featureFlagAuditLog.findMany({
		where: { flagId },
		orderBy: { timestamp: "desc" },
		skip: options?.skip,
		take: options?.take,
	});
};
