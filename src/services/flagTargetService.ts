import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
	featureFlagEnvironments,
	featureFlagSegmentTargets,
} from "../db/schema";
import type { DrizzleClientOrTransaction } from "../repositories/featureFlagRepository";
import type { SegmentTargetInput } from "../schemas/flag.schema";

type EnvironmentMap = Map<string, string>;

// ─────────────────────────────────────────────────────────────────────────────
// Внутренние хелперы
// ─────────────────────────────────────────────────────────────────────────────

const getEnvironmentMap = async (
	flagId: string,
	client: DrizzleClientOrTransaction,
): Promise<EnvironmentMap> => {
	const envs = await client
		.select({
			id: featureFlagEnvironments.id,
			environment: featureFlagEnvironments.environment,
		})
		.from(featureFlagEnvironments)
		.where(eq(featureFlagEnvironments.flagId, flagId));

	return new Map(envs.map((env) => [env.environment, env.id]));
};

const mapSegmentTargetsToCreate = (
	targets: SegmentTargetInput[],
	envMap: EnvironmentMap,
) => {
	return targets
		.map((target) => {
			const envId = envMap.get(target.environment);
			if (!envId) return null;
			return {
				flagEnvironmentId: envId,
				segment: target.segment.trim().toLowerCase(),
				include: target.include,
			};
		})
		.filter(
			(
				t,
			): t is {
				flagEnvironmentId: string;
				segment: string;
				include: boolean;
			} => t !== null,
		);
};

// ─────────────────────────────────────────────────────────────────────────────
// Публичные методы сервиса
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Добавляет segment targets без удаления существующих (skipDuplicates).
 */
export const upsertSegmentTargets = async (
	flagId: string,
	segmentTargets: SegmentTargetInput[],
	client: DrizzleClientOrTransaction = db,
): Promise<void> => {
	const envMap = await getEnvironmentMap(flagId, client);
	const data = mapSegmentTargetsToCreate(segmentTargets, envMap);

	if (data.length === 0) return;

	// Drizzle не имеет skipDuplicates, поэтому используем ON CONFLICT
	for (const item of data) {
		await client
			.insert(featureFlagSegmentTargets)
			.values(item)
			.onConflictDoNothing();
	}
};

/**
 * Полностью заменяет segment targets для флага.
 * Удаляет все существующие и создаёт новые.
 */
export const replaceSegmentTargets = async (
	flagId: string,
	segmentTargets: SegmentTargetInput[],
	client: DrizzleClientOrTransaction = db,
): Promise<void> => {
	const envMap = await getEnvironmentMap(flagId, client);
	const envIds = Array.from(envMap.values());

	if (envIds.length === 0) return;

	// Удаляем все существующие targets для этого флага
	await client
		.delete(featureFlagSegmentTargets)
		.where(inArray(featureFlagSegmentTargets.flagEnvironmentId, envIds));

	const data = mapSegmentTargetsToCreate(segmentTargets, envMap);
	if (data.length > 0) {
		await client.insert(featureFlagSegmentTargets).values(data);
	}
};
