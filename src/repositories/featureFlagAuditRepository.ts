import { desc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { featureFlagAuditLogs } from "../db/schema";
import type { DrizzleClientOrTransaction } from "./featureFlagRepository";

export const logFlagChange = async (
	params: {
		flagId: string;
		action: "create" | "update" | "delete";
		changedBy: string;
		before: unknown;
		after: unknown;
	},
	client: DrizzleClientOrTransaction = db,
) => {
	const [result] = await client
		.insert(featureFlagAuditLogs)
		.values({
			flagId: params.flagId,
			action: params.action,
			changedBy: params.changedBy,
			before: params.before as any,
			after: params.after as any,
		})
		.returning();

	return result;
};

export const getAuditLogForFlag = async (
	flagId: string,
	options?: { skip?: number; take?: number },
	client: DrizzleClientOrTransaction = db,
) => {
	const query = client
		.select()
		.from(featureFlagAuditLogs)
		.where(eq(featureFlagAuditLogs.flagId, flagId))
		.orderBy(desc(featureFlagAuditLogs.timestamp));

	if (options?.skip !== undefined) {
		query.offset(options.skip);
	}

	if (options?.take !== undefined) {
		query.limit(options.take);
	}

	return await query;
};
