import {
	FeatureEnvironment,
	FeatureFlagType,
	type Prisma,
} from "@prisma/client";
import { prisma } from "../db/prisma";

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;

export type EnvironmentConfigInput = {
	environment: FeatureEnvironment;
	enabled?: boolean;
	rolloutPercentage?: number | null;
	forceEnabled?: boolean | null;
	forceDisabled?: boolean | null;
};

export type CreateFeatureFlagInput = {
	key: string;
	name: string;
	description?: string | null;
	tags?: string[];
	type?: FeatureFlagType;
	environments?: EnvironmentConfigInput[];
};

export type UpdateFeatureFlagInput = {
	name?: string;
	description?: string | null;
	tags?: string[];
	type?: FeatureFlagType;
	environments?: EnvironmentConfigInput[];
};

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
		tag?: string;
		skip?: number;
		take?: number;
	},
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const { environment, search, tag, skip, take } = options ?? {};
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
		...(tag ? { tags: { has: tag } } : undefined),
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
				tags: data.tags ?? [],
				type: data.type ?? FeatureFlagType.BOOLEAN,
				environments: {
					create: environments.map((env) => ({
						environment: env.environment,
						enabled: env.enabled ?? false,
						rolloutPercentage: env.rolloutPercentage ?? null,
						forceEnabled: env.forceEnabled ?? null,
						forceDisabled: env.forceDisabled ?? null,
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
			tags: data.tags ?? [],
			type: data.type ?? FeatureFlagType.BOOLEAN,
			environments: {
				create: environments.map((env) => ({
					environment: env.environment,
					enabled: env.enabled ?? false,
					rolloutPercentage: env.rolloutPercentage ?? null,
					forceEnabled: env.forceEnabled ?? null,
					forceDisabled: env.forceDisabled ?? null,
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
		...(data.tags !== undefined ? { tags: data.tags } : undefined),
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
					...(env.forceEnabled !== undefined
						? { forceEnabled: env.forceEnabled }
						: undefined),
					...(env.forceDisabled !== undefined
						? { forceDisabled: env.forceDisabled }
						: undefined),
				},
				create: {
					environment: env.environment,
					enabled: env.enabled ?? false,
					rolloutPercentage: env.rolloutPercentage ?? null,
					forceEnabled: env.forceEnabled ?? null,
					forceDisabled: env.forceDisabled ?? null,
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
