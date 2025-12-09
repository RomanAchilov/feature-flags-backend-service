import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Базовые схемы
// ─────────────────────────────────────────────────────────────────────────────

export const FeatureEnvironmentSchema = z.enum([
	"development",
	"staging",
	"production",
]);

export const FeatureFlagTypeSchema = z.enum(["BOOLEAN", "MULTIVARIANT"]);

export const FlagKeySchema = z
	.string()
	.min(1)
	.max(128)
	.regex(
		/^[a-zA-Z0-9._-]+$/,
		"Key must contain only letters, numbers, dot, underscore, or dash",
	);

export const EnvironmentConfigSchema = z.object({
	environment: FeatureEnvironmentSchema,
	enabled: z.boolean().optional(),
	rolloutPercentage: z.number().min(0).max(100).nullable().optional(),
});

export const SegmentTargetSchema = z.object({
	environment: FeatureEnvironmentSchema,
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
	type: FeatureFlagTypeSchema.optional(),
	environments: z.array(EnvironmentConfigSchema).optional(),
	segmentTargets: z.array(SegmentTargetSchema).optional(),
});

export const UpdateFlagSchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().nullable().optional(),
		type: FeatureFlagTypeSchema.optional(),
		environments: z.array(EnvironmentConfigSchema).nonempty().optional(),
		segmentTargets: z.array(SegmentTargetSchema).optional(),
	})
	.refine(
		(data) =>
			data.name !== undefined ||
			data.description !== undefined ||
			data.type !== undefined ||
			data.environments !== undefined ||
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
	environment: FeatureEnvironmentSchema.optional(),
	search: z.string().optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(200).default(20),
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred Types (Schema First)
// ─────────────────────────────────────────────────────────────────────────────

export type FlagKey = z.infer<typeof FlagKeySchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type SegmentTargetInput = z.infer<typeof SegmentTargetSchema>;
export type CreateFlagInput = z.infer<typeof CreateFlagSchema>;
export type UpdateFlagInput = z.infer<typeof UpdateFlagSchema>;
export type ToggleEnvironmentInput = z.infer<typeof ToggleEnvironmentSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type ListFlagsQuery = z.infer<typeof ListFlagsQuerySchema>;
