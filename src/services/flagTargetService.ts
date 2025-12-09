import type { FeatureEnvironment, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { SegmentTargetInput } from "../schemas/flag.schema";

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;

type EnvironmentMap = Map<FeatureEnvironment, string>;

// ─────────────────────────────────────────────────────────────────────────────
// Внутренние хелперы
// ─────────────────────────────────────────────────────────────────────────────

const getEnvironmentMap = async (
	flagId: string,
	client: PrismaClientOrTransaction,
): Promise<EnvironmentMap> => {
	const envs = await client.featureFlagEnvironment.findMany({
		where: { flagId },
		select: { id: true, environment: true },
	});
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
	client: PrismaClientOrTransaction = prisma,
): Promise<void> => {
	const envMap = await getEnvironmentMap(flagId, client);
	const data = mapSegmentTargetsToCreate(segmentTargets, envMap);

	if (data.length === 0) return;

	await client.featureFlagSegmentTarget.createMany({
		data,
		skipDuplicates: true,
	});
};

/**
 * Полностью заменяет segment targets для флага.
 * Удаляет все существующие и создаёт новые.
 */
export const replaceSegmentTargets = async (
	flagId: string,
	segmentTargets: SegmentTargetInput[],
	client: PrismaClientOrTransaction = prisma,
): Promise<void> => {
	const envMap = await getEnvironmentMap(flagId, client);
	const envIds = Array.from(envMap.values());

	// Удаляем все существующие targets для этого флага
	await client.featureFlagSegmentTarget.deleteMany({
		where: { flagEnvironmentId: { in: envIds } },
	});

	const data = mapSegmentTargetsToCreate(segmentTargets, envMap);
	if (data.length > 0) {
		await client.featureFlagSegmentTarget.createMany({
			data,
			skipDuplicates: true,
		});
	}
};
