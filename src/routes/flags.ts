import {
	FeatureEnvironment,
	FeatureFlagAuditAction,
	FeatureFlagType,
	Prisma,
} from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db/prisma";
import type { CurrentUser } from "../middleware/auth";
import {
	getAuditLogForFlag,
	logFlagChange,
} from "../repositories/featureFlagAuditRepository";
import {
	createFlag,
	deleteFlagByKey,
	getFlagByKey,
	listFlags,
	updateFlagByKey,
} from "../repositories/featureFlagRepository";

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;
type MutationKind = "create" | "update" | "delete";
type MutationStatus = "start" | "success" | "error";
type FlagWithRelations = Prisma.FeatureFlagGetPayload<{
	include: typeof flagWithRelationsInclude;
}>;

const flagWithRelationsInclude = {
	environments: {
		include: {
			userTargets: true,
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

const FlagKeySchema = z
	.string()
	.min(1)
	.max(128)
	.regex(
		/^[a-zA-Z0-9._-]+$/,
		"Key must contain only letters, numbers, dot, underscore, or dash",
	);

const EnvironmentConfigSchema = z
	.object({
		environment: z.nativeEnum(FeatureEnvironment),
		enabled: z.boolean().optional(),
		rolloutPercentage: z.number().min(0).max(100).nullable().optional(),
		forceEnabled: z.boolean().nullable().optional(),
		forceDisabled: z.boolean().nullable().optional(),
	})
	.refine((env) => !(env.forceEnabled && env.forceDisabled), {
		message: "forceEnabled and forceDisabled cannot both be true",
		path: ["forceEnabled"],
	});

const UserTargetSchema = z.object({
	environment: z.nativeEnum(FeatureEnvironment),
	userId: z.string().min(1),
	include: z.boolean(),
});

const SegmentTargetSchema = z.object({
	environment: z.nativeEnum(FeatureEnvironment),
	segment: z.string().min(1),
	include: z.boolean(),
});

const CreateFlagSchema = z.object({
	key: z
		.string()
		.min(1)
		.max(128)
		.regex(
			/^[a-zA-Z0-9._-]+$/,
			"Key must contain only letters, numbers, dot, underscore, or dash",
		),
	name: z.string().min(1),
	description: z.string().nullable().optional(),
	tags: z.array(z.string().min(1)).optional(),
	type: z.nativeEnum(FeatureFlagType).optional(),
	environments: z.array(EnvironmentConfigSchema).optional(),
	userTargets: z.array(UserTargetSchema).optional(),
	segmentTargets: z.array(SegmentTargetSchema).optional(),
});

const UpdateFlagSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		tags: z.array(z.string().min(1)).optional(),
		type: z.nativeEnum(FeatureFlagType).optional(),
		environments: z.array(EnvironmentConfigSchema).nonempty().optional(),
		userTargets: z.array(UserTargetSchema).optional(),
		segmentTargets: z.array(SegmentTargetSchema).optional(),
	})
	.refine(
		(data) =>
			data.name !== undefined ||
			data.description !== undefined ||
			data.tags !== undefined ||
			data.type !== undefined ||
			data.environments !== undefined ||
			data.userTargets !== undefined ||
			data.segmentTargets !== undefined,
		{
			message: "At least one field must be provided",
			path: [],
		},
	);

const ToggleEnvironmentSchema = z.object({
	enabled: z.boolean(),
});

export const flagsRoute = new Hono<{
	Variables: { currentUser: CurrentUser };
}>();

const logMutation = (
	kind: MutationKind,
	key: string,
	status: MutationStatus,
	meta: Record<string, unknown> = {},
) => {
	const payload = {
		mutation: kind,
		key,
		status,
		...meta,
	};
	if (status === "error") {
		console.error("[flags]", payload);
	} else {
		console.info("[flags]", payload);
	}
};

flagsRoute.get("/", async (c) => {
	const environment = c.req.query("environment");
	const search = c.req.query("search") ?? undefined;
	const tag = c.req.query("tag") ?? undefined;
	const page = Number.parseInt(c.req.query("page") ?? "1", 10);
	const pageSize = Number.parseInt(c.req.query("pageSize") ?? "20", 10);

	let envFilter: FeatureEnvironment | undefined;
	if (environment) {
		if (
			!Object.values(FeatureEnvironment).includes(
				environment as FeatureEnvironment,
			)
		) {
			return c.json(
				{ error: { code: "bad_request", message: "Invalid environment" } },
				400,
			);
		}
		envFilter = environment as FeatureEnvironment;
	}

	const skip = page > 0 ? (page - 1) * pageSize : 0;
	const take = pageSize;

	try {
		const flags = await listFlags({
			environment: envFilter,
			search,
			tag,
			skip,
			take,
		});
		return c.json({ data: flags });
	} catch (error) {
		console.error("Failed to list flags", error);
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			// If tables are not yet created or DB is empty/unreachable, respond with an empty list instead of 500.
			return c.json({ data: [] });
		}
		return c.json(
			{ error: { code: "internal_error", message: "Failed to list flags" } },
			500,
		);
	}
});

flagsRoute.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = CreateFlagSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid body",
					details: parsed.error.flatten(),
				},
			},
			400,
		);
	}

	const currentUser = c.get("currentUser");

	try {
		logMutation("create", parsed.data.key, "start");
		const createdFlag = await prisma.$transaction(
			async (tx) => {
				const created = await createFlag(parsed.data, tx);

				if (parsed.data.userTargets && parsed.data.userTargets.length > 0) {
					await upsertUserTargets(created.id, parsed.data.userTargets, tx);
				}
				if (
					parsed.data.segmentTargets &&
					parsed.data.segmentTargets.length > 0
				) {
					await upsertSegmentTargets(
						created.id,
						parsed.data.segmentTargets,
						tx,
					);
				}

				await logFlagChange(
					{
						flagId: created.id,
						action: FeatureFlagAuditAction.create,
						changedBy: currentUser.id ?? "system",
						before: null,
						after: created,
					},
					tx,
				);

				const hydrated = await fetchFlagWithRelations(created.key, tx);
				if (!hydrated) {
					throw new Error("Created flag could not be loaded");
				}
				return hydrated;
			},
			{ timeout: 15000 },
		);

		logMutation("create", parsed.data.key, "success");
		return c.json({ data: createdFlag }, 201);
	} catch (error) {
		logMutation("create", parsed.data.key, "error", {
			message: error instanceof Error ? error.message : String(error),
		});
		console.error("Failed to create flag", error);
		const handled = handlePrismaError(error);
		if (handled) return c.json(handled.body, handled.status as 409 | 400);
		return c.json(
			{ error: { code: "internal_error", message: "Failed to create flag" } },
			500,
		);
	}
});

flagsRoute.get("/:key", async (c) => {
	const keyParsed = FlagKeySchema.safeParse(c.req.param("key"));
	if (!keyParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid flag key",
					details: keyParsed.error.flatten(),
				},
			},
			400,
		);
	}
	const key = keyParsed.data;
	try {
		const flag = await fetchFlagWithRelations(key, prisma, {
			allowFallback: true,
		});
		if (!flag) {
			return c.json(
				{ error: { code: "not_found", message: "Flag not found" } },
				404,
			);
		}
		return c.json({ data: flag });
	} catch (error) {
		console.error("Failed to get flag", error);
		return c.json(
			{ error: { code: "internal_error", message: "Failed to get flag" } },
			500,
		);
	}
});

flagsRoute.get("/:key/audit", async (c) => {
	const keyParsed = FlagKeySchema.safeParse(c.req.param("key"));
	if (!keyParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid flag key",
					details: keyParsed.error.flatten(),
				},
			},
			400,
		);
	}
	const key = keyParsed.data;
	const pageParam = c.req.query("page") ?? "1";
	const pageSizeParam = c.req.query("pageSize") ?? "20";

	const paginationParsed = z
		.object({
			page: z.coerce.number().int().positive().default(1),
			pageSize: z.coerce.number().int().positive().max(200).default(20),
		})
		.safeParse({ page: pageParam, pageSize: pageSizeParam });

	if (!paginationParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid pagination",
					details: paginationParsed.error.flatten(),
				},
			},
			400,
		);
	}

	const { page, pageSize } = paginationParsed.data;
	const skip = (page - 1) * pageSize;
	const take = pageSize;

	try {
		const flag = await getFlagByKey(key);
		if (!flag) {
			return c.json(
				{ error: { code: "not_found", message: "Flag not found" } },
				404,
			);
		}

		const [items, total] = await Promise.all([
			getAuditLogForFlag(flag.id, { skip, take }),
			prisma.featureFlagAuditLog.count({ where: { flagId: flag.id } }),
		]);

		return c.json({
			data: items,
			page,
			pageSize,
			total,
		});
	} catch (error) {
		console.error("Failed to get audit log", error);
		return c.json(
			{ error: { code: "internal_error", message: "Failed to get audit log" } },
			500,
		);
	}
});

flagsRoute.patch("/:key/environments/:environment", async (c) => {
	const keyParsed = FlagKeySchema.safeParse(c.req.param("key"));
	if (!keyParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid flag key",
					details: keyParsed.error.flatten(),
				},
			},
			400,
		);
	}
	const environmentParsed = z
		.nativeEnum(FeatureEnvironment)
		.safeParse(c.req.param("environment"));
	if (!environmentParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid environment",
					details: environmentParsed.error.flatten(),
				},
			},
			400,
		);
	}
	const body = await c.req.json().catch(() => null);
	const parsed = ToggleEnvironmentSchema.safeParse(body);
	const startedAt = Date.now();
	if (!parsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid body",
					details: parsed.error.flatten(),
				},
			},
			400,
		);
	}
	const key = keyParsed.data;
	const targetEnv = environmentParsed.data;
	const currentUser = c.get("currentUser");

	try {
		logMutation("update", key, "start", {
			env: targetEnv,
			enabled: parsed.data.enabled,
			user: currentUser.id,
			mode: "env-toggle",
		});

		const result = await prisma.$transaction(
			async (tx) => {
				const flag = await tx.featureFlag.findFirst({
					where: { key, deletedAt: null },
					select: {
						id: true,
						key: true,
						environments: {
							where: { environment: targetEnv },
							select: { id: true, environment: true, enabled: true },
						},
					},
				});

				if (!flag || flag.environments.length === 0) {
					return null;
				}

				const env = flag.environments[0];
				const updatedEnv = await tx.featureFlagEnvironment.update({
					where: { id: env.id },
					data: { enabled: parsed.data.enabled },
					select: { id: true, environment: true, enabled: true },
				});

				await logFlagChange(
					{
						flagId: flag.id,
						action: FeatureFlagAuditAction.update,
						changedBy: currentUser.id ?? "system",
						before: { environment: env.environment, enabled: env.enabled },
						after: {
							environment: updatedEnv.environment,
							enabled: updatedEnv.enabled,
						},
					},
					tx,
				);

				return {
					key: flag.key,
					environment: updatedEnv.environment,
					enabled: updatedEnv.enabled,
				};
			},
			{ timeout: 10000 },
		);

		if (!result) {
			return c.json(
				{
					error: {
						code: "not_found",
						message: "Flag or environment not found",
					},
				},
				404,
			);
		}

		logMutation("update", key, "success", {
			mode: "env-toggle",
			env: targetEnv,
			elapsedMs: Date.now() - startedAt,
		});

		return c.json({ data: result });
	} catch (error) {
		logMutation("update", key, "error", {
			mode: "env-toggle",
			env: targetEnv,
			elapsedMs: Date.now() - startedAt,
		});
		console.error("Failed to toggle environment", error);
		const handled = handlePrismaError(error);
		if (handled) return c.json(handled.body, handled.status as 409 | 400);
		return c.json(
			{
				error: {
					code: "internal_error",
					message: "Failed to toggle environment",
				},
			},
			500,
		);
	}
});

flagsRoute.patch("/:key", async (c) => {
	const keyParsed = FlagKeySchema.safeParse(c.req.param("key"));
	if (!keyParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid flag key",
					details: keyParsed.error.flatten(),
				},
			},
			400,
		);
	}
	const key = keyParsed.data;
	const body = await c.req.json().catch(() => null);
	const parsed = UpdateFlagSchema.safeParse(body);
	const startedAt = Date.now();
	if (!parsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid body",
					details: parsed.error.flatten(),
				},
			},
			400,
		);
	}

	const currentUser = c.get("currentUser");

	try {
		logMutation("update", key, "start", {
			user: currentUser.id,
			envs: parsed.data.environments?.length ?? 0,
			userTargets: parsed.data.userTargets?.length ?? 0,
			segmentTargets: parsed.data.segmentTargets?.length ?? 0,
		});
		const after = await prisma.$transaction(
			async (tx) => {
				const before = await fetchFlagWithRelations(key, tx, {
					allowFallback: true,
					fallbackClient: prisma,
				});
				if (!before) return null;

				const updated = await updateFlagByKey(
					key,
					parsed.data,
					tx,
					flagWithRelationsInclude,
				);
				if (!updated) return null;

				const hasTargetUpdates =
					Boolean(parsed.data.userTargets) ||
					Boolean(parsed.data.segmentTargets);

				if (parsed.data.userTargets) {
					await replaceUserTargets(updated.id, parsed.data.userTargets, tx);
				}
				if (parsed.data.segmentTargets) {
					await replaceSegmentTargets(
						updated.id,
						parsed.data.segmentTargets,
						tx,
					);
				}

				const hydrated = hasTargetUpdates
					? await fetchFlagWithRelations(key, tx, {
							allowFallback: true,
							fallbackClient: prisma,
						})
					: updated;
				if (!hydrated) return null;

				await logFlagChange(
					{
						flagId: updated.id,
						action: FeatureFlagAuditAction.update,
						changedBy: currentUser.id ?? "system",
						before,
						after: hydrated,
					},
					tx,
				);

				return hydrated;
			},
			{ timeout: 15000 },
		);

		if (!after) {
			return c.json(
				{ error: { code: "not_found", message: "Flag not found" } },
				404,
			);
		}

		logMutation("update", key, "success", {
			elapsedMs: Date.now() - startedAt,
		});
		return c.json({ data: after });
	} catch (error) {
		logMutation("update", key, "error", {
			elapsedMs: Date.now() - startedAt,
		});
		console.error("Failed to update flag", error);
		const handled = handlePrismaError(error);
		if (handled) return c.json(handled.body, handled.status as 409 | 400);
		return c.json(
			{ error: { code: "internal_error", message: "Failed to update flag" } },
			500,
		);
	}
});

flagsRoute.delete("/:key", async (c) => {
	const keyParsed = FlagKeySchema.safeParse(c.req.param("key"));
	if (!keyParsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid flag key",
					details: keyParsed.error.flatten(),
				},
			},
			400,
		);
	}
	const key = keyParsed.data;
	const currentUser = c.get("currentUser");

	try {
		const existing = await fetchFlagWithRelations(key);
		if (!existing) {
			return c.json(
				{ error: { code: "not_found", message: "Flag not found" } },
				404,
			);
		}

		const deleted = await deleteFlagByKey(key);
		if (!deleted) {
			return c.json(
				{ error: { code: "not_found", message: "Flag not found" } },
				404,
			);
		}

		await logFlagChange({
			flagId: existing.id,
			action: FeatureFlagAuditAction.delete,
			changedBy: currentUser.id ?? "system",
			before: existing,
			after: null,
		});

		// Soft delete keeps data for audit; consumers should ignore flags with deletedAt set.
		return c.json({ data: { deleted: true } });
	} catch (error) {
		console.error("Failed to delete flag", error);
		return c.json(
			{ error: { code: "internal_error", message: "Failed to delete flag" } },
			500,
		);
	}
});

const fetchFlagWithRelations = async (
	key: string,
	prismaClient: PrismaClientOrTransaction = prisma,
	options?: { allowFallback?: boolean; fallbackClient?: typeof prisma },
): Promise<FlagWithRelations | null> => {
	const client = prismaClient ?? prisma;
	const fallbackClient = options?.fallbackClient ?? prisma;
	try {
		return await client.featureFlag.findFirst({
			where: { key, deletedAt: null },
			include: flagWithRelationsInclude,
		});
	} catch (error) {
		if (options?.allowFallback) {
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
					tags: true,
					type: true,
					createdAt: true,
					updatedAt: true,
					deletedAt: true,
				},
			});
			if (!minimal) return null;
			return {
				...minimal,
				environments: [] as FlagWithRelations["environments"],
				auditLogs: [] as FlagWithRelations["auditLogs"],
			} satisfies FlagWithRelations;
		}
		throw error;
	}
};

const upsertUserTargets = async (
	flagId: string,
	userTargets: z.infer<typeof UserTargetSchema>[],
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;
	const envs = await client.featureFlagEnvironment.findMany({
		where: { flagId },
	});
	const envMap = new Map(envs.map((env) => [env.environment, env.id]));

	const targetsToCreate = userTargets
		.map((target) => {
			const envId = envMap.get(target.environment);
			if (!envId) return null;
			return {
				flagEnvironmentId: envId,
				userId: target.userId,
				include: target.include,
			};
		})
		.filter(Boolean) as {
		flagEnvironmentId: string;
		userId: string;
		include: boolean;
	}[];

	if (targetsToCreate.length === 0) return;

	await client.featureFlagUserTarget.createMany({
		data: targetsToCreate,
		skipDuplicates: true,
	});
};

const upsertSegmentTargets = async (
	flagId: string,
	segmentTargets: z.infer<typeof SegmentTargetSchema>[],
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;
	const envs = await client.featureFlagEnvironment.findMany({
		where: { flagId },
	});
	const envMap = new Map(envs.map((env) => [env.environment, env.id]));

	const targetsToCreate = segmentTargets
		.map((target) => {
			const envId = envMap.get(target.environment);
			if (!envId) return null;
			return {
				flagEnvironmentId: envId,
				segment: target.segment.trim().toLowerCase(),
				include: target.include,
			};
		})
		.filter(Boolean) as {
		flagEnvironmentId: string;
		segment: string;
		include: boolean;
	}[];

	if (targetsToCreate.length === 0) return;

	await client.featureFlagSegmentTarget.createMany({
		data: targetsToCreate,
		skipDuplicates: true,
	});
};

const replaceUserTargets = async (
	flagId: string,
	userTargets: z.infer<typeof UserTargetSchema>[],
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;
	const envs = await client.featureFlagEnvironment.findMany({
		where: { flagId },
	});
	const envMap = new Map(envs.map((env) => [env.environment, env.id]));
	const validEnvIds = Array.from(envMap.values());
	const targetsToCreate = userTargets
		.map((target) => {
			const envId = envMap.get(target.environment);
			if (!envId) return null;
			return {
				flagEnvironmentId: envId,
				userId: target.userId,
				include: target.include,
			};
		})
		.filter(Boolean) as {
		flagEnvironmentId: string;
		userId: string;
		include: boolean;
	}[];

	// Replace all targets for the flag (per environment) with provided set to keep state in sync.
	await client.featureFlagUserTarget.deleteMany({
		where: { flagEnvironmentId: { in: validEnvIds } },
	});

	if (targetsToCreate.length > 0) {
		await client.featureFlagUserTarget.createMany({
			data: targetsToCreate,
			skipDuplicates: true,
		});
	}
};

const replaceSegmentTargets = async (
	flagId: string,
	segmentTargets: z.infer<typeof SegmentTargetSchema>[],
	prismaClient: PrismaClientOrTransaction = prisma,
) => {
	const client = prismaClient ?? prisma;
	const envs = await client.featureFlagEnvironment.findMany({
		where: { flagId },
	});
	const envMap = new Map(envs.map((env) => [env.environment, env.id]));
	const validEnvIds = Array.from(envMap.values());
	const targetsToCreate = segmentTargets
		.map((target) => {
			const envId = envMap.get(target.environment);
			if (!envId) return null;
			return {
				flagEnvironmentId: envId,
				segment: target.segment.trim().toLowerCase(),
				include: target.include,
			};
		})
		.filter(Boolean) as {
		flagEnvironmentId: string;
		segment: string;
		include: boolean;
	}[];

	await client.featureFlagSegmentTarget.deleteMany({
		where: { flagEnvironmentId: { in: validEnvIds } },
	});

	if (targetsToCreate.length > 0) {
		await client.featureFlagSegmentTarget.createMany({
			data: targetsToCreate,
			skipDuplicates: true,
		});
	}
};

const handlePrismaError = (
	error: unknown,
): {
	status: number;
	body: { error: { code: string; message: string } };
} | null => {
	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		if (error.code === "P2002") {
			return {
				status: 409,
				body: {
					error: {
						code: "conflict",
						message: "Flag with this key already exists",
					},
				},
			};
		}
		if (error.code === "P2003" || error.code === "P2025") {
			return {
				status: 400,
				body: {
					error: {
						code: "bad_request",
						message: "Invalid reference or missing record",
					},
				},
			};
		}
	}
	return null;
};
