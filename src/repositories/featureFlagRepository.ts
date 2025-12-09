import {
	FeatureEnvironment,
	FeatureFlagType,
	type Prisma,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import type {
	CreateFlagInput,
	EnvironmentConfig,
	UpdateFlagInput,
} from "../schemas/flag.schema";

export type PrismaClientOrTransaction =
	| Prisma.TransactionClient
	| typeof prisma;

// Re-export для обратной совместимости (deprecated, использовать из schemas)
export type EnvironmentConfigInput = EnvironmentConfig;
export type CreateFeatureFlagInput = CreateFlagInput;
export type UpdateFeatureFlagInput = UpdateFlagInput;

// ─────────────────────────────────────────────────────────────────────────────
// Константы для include-паттернов
// ─────────────────────────────────────────────────────────────────────────────

export const FLAG_WITH_RELATIONS_INCLUDE = {
	environments: {
		include: {
			segmentTargets: {
				orderBy: { createdAt: "asc" },
			},
		},
	},
	auditLogs: {
		orderBy: { timestamp: "desc" },
		take: 5,
	},
} satisfies Prisma.FeatureFlagInclude;

export type FlagWithRelations = Prisma.FeatureFlagGetPayload<{
	include: typeof FLAG_WITH_RELATIONS_INCLUDE;
}>;

// Получить флаг по ключу; выбрасывает Prisma ошибки при проблемах с подключением.
export const getFlagByKey = async (
	key: string,
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;

	return client.featureFlag.findFirst({
		where: { key, deletedAt: null },
		include: {
			environments: true,
		},
	});
};

// Список флагов с фильтрами/пагинацией; может выбросить PrismaClientKnownRequestError при неверных параметрах.
export const listFlags = async (
	options?: {
		environment?: FeatureEnvironment;
		search?: string;
		skip?: number;
		take?: number;
	},
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const { environment, search, skip, take } = options ?? {};
	const client = prismaClient ?? prisma;

	const where: Prisma.FeatureFlagWhereInput = {
		deletedAt: null,
		...(search
			? {
					OR: [
						{ key: { contains: search, mode: "insensitive" } },
						{ name: { contains: search, mode: "insensitive" } },
					],
				}
			: undefined),
	};

	return client.featureFlag.findMany({
		where,
		include: {
			environments: environment
				? {
						where: { environment },
					}
				: true,
		},
		orderBy: { createdAt: "desc" },
		skip,
		take,
	});
};

// Создать флаг с базовой конфигурацией по окружениям; может выбросить уникальный конфликт по ключу.
export const createFlag = async (
	data: CreateFeatureFlagInput,
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;

	const defaultEnvironments: EnvironmentConfigInput[] = Object.values(
		FeatureEnvironment,
	).map((environment) => ({ environment }));

	const environments =
		data.environments && data.environments.length > 0
			? dedupeEnvironments(data.environments)
			: defaultEnvironments;

	// If a soft-deleted flag with the same key exists, revive it instead of failing with unique conflict.
	const existing = await client.featureFlag.findFirst({
		where: { key: data.key },
		include: { environments: true },
	});

	if (existing?.deletedAt) {
		await client.featureFlagEnvironment.deleteMany({
			where: { flagId: existing.id },
		});

		return client.featureFlag.update({
			where: { id: existing.id },
			data: {
				deletedAt: null,
				name: data.name,
				description: data.description ?? null,
				tags: [],
				type: data.type ?? FeatureFlagType.BOOLEAN,
				environments: {
					create: environments.map((env) => ({
						environment: env.environment,
						enabled: env.enabled ?? false,
						rolloutPercentage: env.rolloutPercentage ?? null,
					})),
				},
			},
			include: { environments: true },
		});
	}

	return client.featureFlag.create({
		data: {
			key: data.key,
			name: data.name,
			description: data.description ?? null,
			tags: [],
			type: data.type ?? FeatureFlagType.BOOLEAN,
			environments: {
				create: environments.map((env) => ({
					environment: env.environment,
					enabled: env.enabled ?? false,
					rolloutPercentage: env.rolloutPercentage ?? null,
				})),
			},
		},
		include: { environments: true },
	});
};

// Обновить флаг по ключу; возвращает null, если флаг не найден/удален; может выбросить ошибки целостности при upsert окружений.
export const updateFlagByKey = async (
	key: string,
	data: UpdateFeatureFlagInput,
	prismaClient: PrismaClientOrTransaction = prisma,
	include: Prisma.FeatureFlagInclude = { environments: true },
) => {
	const client = prismaClient ?? prisma;

	const existing = await client.featureFlag.findFirst({
		where: { key, deletedAt: null },
	});

	if (!existing) {
		return null;
	}

	const updateData: Prisma.FeatureFlagUpdateInput = {
		...(data.name !== undefined ? { name: data.name } : undefined),
		...(data.description !== undefined
			? { description: data.description }
			: undefined),
		...(data.type !== undefined ? { type: data.type } : undefined),
	};

	if (data.environments) {
		const envs = dedupeEnvironments(data.environments);
		updateData.environments = {
			upsert: envs.map((env) => ({
				where: {
					flagId_environment: {
						flagId: existing.id,
						environment: env.environment,
					},
				},
				update: {
					...(env.enabled !== undefined ? { enabled: env.enabled } : undefined),
					...(env.rolloutPercentage !== undefined
						? { rolloutPercentage: env.rolloutPercentage }
						: undefined),
				},
				create: {
					environment: env.environment,
					enabled: env.enabled ?? false,
					rolloutPercentage: env.rolloutPercentage ?? null,
				},
			})),
		};
	}

	return client.featureFlag.update({
		where: { id: existing.id },
		data: updateData,
		include,
	});
};

// Мягкое удаление по ключу (проставляет deletedAt); возвращает true, если запись была обновлена. Полезно, чтобы сохранить аудит и ссылки.
export const deleteFlagByKey = async (key: string) => {
	const result = await prisma.featureFlag.updateMany({
		where: { key, deletedAt: null },
		data: { deletedAt: new Date() },
	});

	return result.count > 0;
};

const dedupeEnvironments = (envs: EnvironmentConfigInput[]) => {
	const seen = new Set<FeatureEnvironment>();
	const result: EnvironmentConfigInput[] = [];

	for (const env of envs) {
		if (seen.has(env.environment)) {
			continue;
		}

		seen.add(env.environment);
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
	/** Клиент для fallback-запроса (по умолчанию prisma) */
	fallbackClient?: typeof prisma;
};

/**
 * Загружает флаг со всеми связями (environments, targets, audit logs).
 * При allowFallback=true в случае ошибки вернёт минимальный объект без связей.
 */
export const fetchFlagWithRelations = async (
	key: string,
	client: PrismaClientOrTransaction = prisma,
	options?: FetchFlagOptions,
): Promise<FlagWithRelations | null> => {
	const fallbackClient = options?.fallbackClient ?? prisma;

	try {
		return await client.featureFlag.findFirst({
			where: { key, deletedAt: null },
			include: FLAG_WITH_RELATIONS_INCLUDE,
		});
	} catch (error) {
		if (!options?.allowFallback) {
			throw error;
		}

		console.warn(
			"Failed to load flag with relations, falling back to minimal select",
			error,
		);

		const minimal = await fallbackClient.featureFlag.findFirst({
			where: { key, deletedAt: null },
			select: {
				id: true,
				key: true,
				name: true,
				description: true,
				type: true,
				createdAt: true,
				updatedAt: true,
				deletedAt: true,
			},
		});

		if (!minimal) return null;

		// Возвращаем структуру, совместимую с FlagWithRelations
		return {
			...minimal,
			tags: [],
			environments: [] as FlagWithRelations["environments"],
			auditLogs: [] as FlagWithRelations["auditLogs"],
		} satisfies FlagWithRelations;
	}
};
