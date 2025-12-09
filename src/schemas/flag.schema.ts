import { FeatureEnvironment, FeatureFlagType } from "@prisma/client";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Базовые схемы
// ─────────────────────────────────────────────────────────────────────────────

export const FlagKeySchema = z
	.string()
	.min(1)
	.max(128)
	.regex(
		/^[a-zA-Z0-9._-]+$/,
		"Key must contain only letters, numbers, dot, underscore, or dash",
	);

export const EnvironmentConfigSchema = z
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

export const UserTargetSchema = z.object({
	environment: z.nativeEnum(FeatureEnvironment),
	userId: z.string().min(1),
	include: z.boolean(),
});

export const SegmentTargetSchema = z.object({
	environment: z.nativeEnum(FeatureEnvironment),
	segment: z.string().min(1),
	include: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Схемы для CRUD операций
// ─────────────────────────────────────────────────────────────────────────────

export const CreateFlagSchema = z.object({
	key: FlagKeySchema,
	name: z.string().min(1),
	description: z.string().nullable().optional(),
	type: z.nativeEnum(FeatureFlagType).optional(),
	environments: z.array(EnvironmentConfigSchema).optional(),
	userTargets: z.array(UserTargetSchema).optional(),
	segmentTargets: z.array(SegmentTargetSchema).optional(),
});

export const UpdateFlagSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		type: z.nativeEnum(FeatureFlagType).optional(),
		environments: z.array(EnvironmentConfigSchema).nonempty().optional(),
		userTargets: z.array(UserTargetSchema).optional(),
		segmentTargets: z.array(SegmentTargetSchema).optional(),
	})
	.refine(
		(data) =>
			data.name !== undefined ||
			data.description !== undefined ||
			data.type !== undefined ||
			data.environments !== undefined ||
			data.userTargets !== undefined ||
			data.segmentTargets !== undefined,
		{
			message: "At least one field must be provided",
			path: [],
		},
	);

export const ToggleEnvironmentSchema = z.object({
	enabled: z.boolean(),
});

export const PaginationSchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(200).default(20),
});

export const ListFlagsQuerySchema = z.object({
	environment: z.nativeEnum(FeatureEnvironment).optional(),
	search: z.string().optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(200).default(20),
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred Types (Schema First)
// ─────────────────────────────────────────────────────────────────────────────

export type FlagKey = z.infer<typeof FlagKeySchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type UserTargetInput = z.infer<typeof UserTargetSchema>;
export type SegmentTargetInput = z.infer<typeof SegmentTargetSchema>;
export type CreateFlagInput = z.infer<typeof CreateFlagSchema>;
export type UpdateFlagInput = z.infer<typeof UpdateFlagSchema>;
export type ToggleEnvironmentInput = z.infer<typeof ToggleEnvironmentSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type ListFlagsQuery = z.infer<typeof ListFlagsQuerySchema>;
