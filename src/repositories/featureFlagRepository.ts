import {
	and,
	desc,
	type ExtractTablesWithRelations,
	eq,
	ilike,
	inArray,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "../db/drizzle";
import {
	type FeatureFlag,
	type FeatureFlagAuditLog,
	type FeatureFlagEnvironment,
	type FeatureFlagSegmentTarget,
	featureFlagAuditLogs,
	featureFlagEnvironments,
	featureFlagSegmentTargets,
	featureFlags,
} from "../db/schema";
import type {
	CreateFlagInput,
	EnvironmentConfig,
	UpdateFlagInput,
} from "../schemas/flag.schema";
import {
	FeatureEnvironmentSchema,
	FeatureFlagTypeSchema,
} from "../schemas/flag.schema";

export type DrizzleDb = typeof db;
export type DrizzleTransaction = PgTransaction<
	any,
	any,
	ExtractTablesWithRelations<any>
>;

export type DrizzleClientOrTransaction = DrizzleDb | DrizzleTransaction;

// Re-export для обратной совместимости (deprecated, использовать из schemas)
export type EnvironmentConfigInput = EnvironmentConfig;
export type CreateFeatureFlagInput = CreateFlagInput;
export type UpdateFeatureFlagInput = UpdateFlagInput;

// ─────────────────────────────────────────────────────────────────────────────
// Типы для флагов с relations
// ─────────────────────────────────────────────────────────────────────────────

export type FlagWithRelations = FeatureFlag & {
	environments: Array<
		FeatureFlagEnvironment & {
			segmentTargets: FeatureFlagSegmentTarget[];
		}
	>;
	auditLogs: FeatureFlagAuditLog[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Получение флага по ключу
// ─────────────────────────────────────────────────────────────────────────────

export const getFlagByKey = async (
	key: string,
	client: DrizzleClientOrTransaction = db,
) => {
	const flags = await client
		.select()
		.from(featureFlags)
		.where(and(eq(featureFlags.key, key), isNull(featureFlags.deletedAt)))
		.limit(1);

	if (flags.length === 0) {
		return null;
	}

	const flag = flags[0];

	const envs = await client
		.select()
		.from(featureFlagEnvironments)
		.where(eq(featureFlagEnvironments.flagId, flag.id));

	return {
		...flag,
		environments: envs,
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Список флагов с фильтрами/пагинацией
// ─────────────────────────────────────────────────────────────────────────────

export const listFlags = async (
	options?: {
		environment?: "development" | "staging" | "production";
		search?: string;
		skip?: number;
		take?: number;
	},
	client: DrizzleClientOrTransaction = db,
) => {
	const { environment, search, skip, take } = options ?? {};

	const whereConditions = [isNull(featureFlags.deletedAt)];

	if (search) {
		whereConditions.push(
			or(
				ilike(featureFlags.key, `%${search}%`),
				ilike(featureFlags.name, `%${search}%`),
			)!,
		);
	}

	const flags = await client
		.select()
		.from(featureFlags)
		.where(and(...whereConditions))
		.orderBy(desc(featureFlags.createdAt))
		.limit(take ?? 100)
		.offset(skip ?? 0);

	if (flags.length === 0) {
		return [];
	}

	const flagIds = flags.map((f) => f.id);

	const envWhereConditions = [inArray(featureFlagEnvironments.flagId, flagIds)];

	if (environment) {
		envWhereConditions.push(
			eq(featureFlagEnvironments.environment, environment),
		);
	}

	const envs = await client
		.select()
		.from(featureFlagEnvironments)
		.where(and(...envWhereConditions));

	// Группируем environments по flagId
	const envsByFlagId = new Map<string, FeatureFlagEnvironment[]>();
	for (const env of envs) {
		const existing = envsByFlagId.get(env.flagId) ?? [];
		existing.push(env);
		envsByFlagId.set(env.flagId, existing);
	}

	return flags.map((flag) => ({
		...flag,
		environments: envsByFlagId.get(flag.id) ?? [],
	}));
};

// ─────────────────────────────────────────────────────────────────────────────
// Создание флага
// ─────────────────────────────────────────────────────────────────────────────

export const createFlag = async (
	data: CreateFeatureFlagInput,
	client: DrizzleClientOrTransaction = db,
) => {
	const defaultEnvironments: EnvironmentConfigInput[] = [
		"development",
		"staging",
		"production",
	].map((environment) => ({ environment: environment as any }));

	const environments =
		data.environments && data.environments.length > 0
			? dedupeEnvironments(data.environments)
			: defaultEnvironments;

	// Проверяем, существует ли флаг с таким ключом (включая soft-deleted)
	const existing = await client
		.select()
		.from(featureFlags)
		.where(eq(featureFlags.key, data.key))
		.limit(1);

	if (existing.length > 0 && existing[0].deletedAt) {
		// Восстанавливаем soft-deleted флаг
		const flagId = existing[0].id;

		// Удаляем старые environments
		await client
			.delete(featureFlagEnvironments)
			.where(eq(featureFlagEnvironments.flagId, flagId));

		// Обновляем флаг
		const [updatedFlag] = await client
			.update(featureFlags)
			.set({
				deletedAt: null,
				name: data.name,
				description: data.description ?? null,
				type: (data.type ?? "BOOLEAN") as "BOOLEAN" | "MULTIVARIANT",
				updatedAt: new Date(),
			})
			.where(eq(featureFlags.id, flagId))
			.returning();

		// Создаём новые environments
		const newEnvs = await client
			.insert(featureFlagEnvironments)
			.values(
				environments.map((env) => ({
					flagId,
					environment: env.environment,
					enabled: env.enabled ?? false,
					rolloutPercentage: env.rolloutPercentage ?? null,
				})),
			)
			.returning();

		return {
			...updatedFlag,
			environments: newEnvs,
		};
	}

	// Создаём новый флаг
	const [newFlag] = await client
		.insert(featureFlags)
		.values({
			key: data.key,
			name: data.name,
			description: data.description ?? null,
			type: (data.type ?? "BOOLEAN") as "BOOLEAN" | "MULTIVARIANT",
		})
		.returning();

	const newEnvs = await client
		.insert(featureFlagEnvironments)
		.values(
			environments.map((env) => ({
				flagId: newFlag.id,
				environment: env.environment,
				enabled: env.enabled ?? false,
				rolloutPercentage: env.rolloutPercentage ?? null,
			})),
		)
		.returning();

	return {
		...newFlag,
		environments: newEnvs,
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Обновление флага по ключу
// ─────────────────────────────────────────────────────────────────────────────

export const updateFlagByKey = async (
	key: string,
	data: UpdateFeatureFlagInput,
	client: DrizzleClientOrTransaction = db,
) => {
	const existing = await client
		.select()
		.from(featureFlags)
		.where(and(eq(featureFlags.key, key), isNull(featureFlags.deletedAt)))
		.limit(1);

	if (existing.length === 0) {
		return null;
	}

	const flag = existing[0];
	const updateData: Partial<FeatureFlag> = {};

	if (data.name !== undefined) {
		updateData.name = data.name;
	}
	if (data.description !== undefined) {
		updateData.description = data.description;
	}
	if (data.type !== undefined) {
		updateData.type = data.type as "BOOLEAN" | "MULTIVARIANT";
	}

	if (Object.keys(updateData).length > 0) {
		updateData.updatedAt = new Date();
		await client
			.update(featureFlags)
			.set(updateData)
			.where(eq(featureFlags.id, flag.id));
	}

	if (data.environments) {
		const envs = dedupeEnvironments(data.environments);

		for (const env of envs) {
			const existingEnv = await client
				.select()
				.from(featureFlagEnvironments)
				.where(
					and(
						eq(featureFlagEnvironments.flagId, flag.id),
						eq(featureFlagEnvironments.environment, env.environment as any),
					),
				)
				.limit(1);

			const envData: Partial<FeatureFlagEnvironment> = {};
			if (env.enabled !== undefined) {
				envData.enabled = env.enabled;
			}
			if (env.rolloutPercentage !== undefined) {
				envData.rolloutPercentage = env.rolloutPercentage;
			}

			if (existingEnv.length > 0) {
				// Обновляем существующий
				envData.updatedAt = new Date();
				await client
					.update(featureFlagEnvironments)
					.set(envData)
					.where(eq(featureFlagEnvironments.id, existingEnv[0].id));
			} else {
				// Создаём новый
				await client.insert(featureFlagEnvironments).values({
					flagId: flag.id,
					environment: env.environment,
					enabled: env.enabled ?? false,
					rolloutPercentage: env.rolloutPercentage ?? null,
				});
			}
		}
	}

	// Загружаем обновлённый флаг с environments
	const updated = await getFlagByKey(key, client);
	return updated;
};

// ─────────────────────────────────────────────────────────────────────────────
// Мягкое удаление по ключу
// ─────────────────────────────────────────────────────────────────────────────

export const deleteFlagByKey = async (key: string) => {
	const result = await db
		.update(featureFlags)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(featureFlags.key, key), isNull(featureFlags.deletedAt)))
		.returning();

	return result.length > 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

const dedupeEnvironments = (envs: EnvironmentConfigInput[]) => {
	const seen = new Set<string>();
	const result: EnvironmentConfigInput[] = [];

	for (const env of envs) {
		const envKey = env.environment;
		if (seen.has(envKey)) {
			continue;
		}

		seen.add(envKey);
		result.push(env);
	}

	return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// Загрузка флага с полными связями
// ─────────────────────────────────────────────────────────────────────────────

export type FetchFlagOptions = {
	/** Если true, при ошибке загрузки связей вернёт минимальный объект */
	allowFallback?: boolean;
	/** Клиент для fallback-запроса (по умолчанию db) */
	fallbackClient?: DrizzleDb;
};

/**
 * Загружает флаг со всеми связями (environments, targets, audit logs).
 * При allowFallback=true в случае ошибки вернёт минимальный объект без связей.
 */
export const fetchFlagWithRelations = async (
	key: string,
	client: DrizzleClientOrTransaction = db,
	options?: FetchFlagOptions,
): Promise<FlagWithRelations | null> => {
	const fallbackClient = options?.fallbackClient ?? db;

	try {
		const flags = await client
			.select()
			.from(featureFlags)
			.where(and(eq(featureFlags.key, key), isNull(featureFlags.deletedAt)))
			.limit(1);

		if (flags.length === 0) {
			return null;
		}

		const flag = flags[0];

		// Загружаем environments с segmentTargets
		const envs = await client
			.select()
			.from(featureFlagEnvironments)
			.where(eq(featureFlagEnvironments.flagId, flag.id));

		const envIds = envs.map((e) => e.id);

		const segmentTargets =
			envIds.length > 0
				? await client
						.select()
						.from(featureFlagSegmentTargets)
						.where(inArray(featureFlagSegmentTargets.flagEnvironmentId, envIds))
						.orderBy(featureFlagSegmentTargets.createdAt)
				: [];

		// Группируем segmentTargets по flagEnvironmentId
		const targetsByEnvId = new Map<string, FeatureFlagSegmentTarget[]>();
		for (const target of segmentTargets) {
			const existing = targetsByEnvId.get(target.flagEnvironmentId) ?? [];
			existing.push(target);
			targetsByEnvId.set(target.flagEnvironmentId, existing);
		}

		// Загружаем audit logs
		const auditLogs = await client
			.select()
			.from(featureFlagAuditLogs)
			.where(eq(featureFlagAuditLogs.flagId, flag.id))
			.orderBy(desc(featureFlagAuditLogs.timestamp))
			.limit(5);

		return {
			...flag,
			environments: envs.map((env) => ({
				...env,
				segmentTargets: targetsByEnvId.get(env.id) ?? [],
			})),
			auditLogs,
		};
	} catch (error) {
		if (!options?.allowFallback) {
			throw error;
		}

		console.warn(
			"Failed to load flag with relations, falling back to minimal select",
			error,
		);

		const minimal = await fallbackClient
			.select({
				id: featureFlags.id,
				key: featureFlags.key,
				name: featureFlags.name,
				description: featureFlags.description,
				type: featureFlags.type,
				createdAt: featureFlags.createdAt,
				updatedAt: featureFlags.updatedAt,
				deletedAt: featureFlags.deletedAt,
			})
			.from(featureFlags)
			.where(and(eq(featureFlags.key, key), isNull(featureFlags.deletedAt)))
			.limit(1);

		if (minimal.length === 0) {
			return null;
		}

		// Возвращаем структуру, совместимую с FlagWithRelations
		return {
			...minimal[0],
			environments: [],
			auditLogs: [],
		};
	}
};
