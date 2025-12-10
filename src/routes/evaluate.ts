import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/drizzle";
import {
	featureFlagEnvironments,
	featureFlagSegmentTargets,
	featureFlags,
} from "../db/schema";
import type {
	Environment,
	FeatureFlagWithEnvs,
	UserContext,
} from "../domain/featureFlagTypes";
import type { CurrentUser } from "../middleware/auth";
import { evaluateFeatureFlag } from "../services/featureFlagService";

const EvaluateSchema = z.object({
	environment: z.enum(["development", "staging", "production"]),
	user: z.object({
		id: z.string().min(1),
		segments: z.array(z.string().min(1)).optional(),
		phoneNumber: z.string().optional(),
		birthDate: z.string().optional(),
	}),
	flags: z.array(z.string().min(1)),
});

export const evaluateRoute = new Hono<{
	Variables: { currentUser: CurrentUser };
}>();

evaluateRoute.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = EvaluateSchema.safeParse(body);
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

	const { environment, user, flags } = parsed.data;

	try {
		// Загружаем флаги
		const foundFlags = await db
			.select()
			.from(featureFlags)
			.where(
				and(inArray(featureFlags.key, flags), isNull(featureFlags.deletedAt)),
			);

		if (foundFlags.length === 0) {
			return c.json({
				flags: Object.fromEntries(flags.map((k) => [k, false])),
			});
		}

		const flagIds = foundFlags.map((f) => f.id);

		// Загружаем environments
		const envs = await db
			.select()
			.from(featureFlagEnvironments)
			.where(inArray(featureFlagEnvironments.flagId, flagIds));

		const envIds = envs.map((e) => e.id);

		// Загружаем segment targets
		const segmentTargets =
			envIds.length > 0
				? await db
						.select()
						.from(featureFlagSegmentTargets)
						.where(inArray(featureFlagSegmentTargets.flagEnvironmentId, envIds))
						.orderBy(featureFlagSegmentTargets.createdAt)
				: [];

		// Группируем данные
		const envsByFlagId = new Map<string, typeof envs>();
		for (const env of envs) {
			const existing = envsByFlagId.get(env.flagId) ?? [];
			existing.push(env);
			envsByFlagId.set(env.flagId, existing);
		}

		const targetsByEnvId = new Map<string, typeof segmentTargets>();
		for (const target of segmentTargets) {
			const existing = targetsByEnvId.get(target.flagEnvironmentId) ?? [];
			existing.push(target);
			targetsByEnvId.set(target.flagEnvironmentId, existing);
		}

		const domainFlags: Record<string, FeatureFlagWithEnvs> = {};
		for (const flag of foundFlags) {
			const flagEnvs = envsByFlagId.get(flag.id) ?? [];
			domainFlags[flag.key] = {
				id: flag.id,
				key: flag.key,
				name: flag.name,
				description: flag.description,
				type: flag.type as "BOOLEAN" | "MULTIVARIANT",
				environments: flagEnvs.map((env) => ({
					environment: env.environment as Environment,
					enabled: env.enabled,
					rolloutPercentage: env.rolloutPercentage,
					segmentTargets:
						targetsByEnvId.get(env.id)?.map((target) => ({
							segment: target.segment.toLowerCase(),
							include: target.include,
						})) ?? [],
				})),
			};
		}

		const result: Record<string, boolean> = {};
		for (const key of flags) {
			const flag = domainFlags[key];
			if (!flag) {
				result[key] = false;
				continue;
			}
			result[key] = evaluateFeatureFlag(
				flag,
				environment as Environment,
				user as UserContext,
			);
		}

		return c.json({ flags: result });
	} catch (error) {
		console.error("Failed to evaluate flags", error);
		return c.json(
			{
				error: { code: "internal_error", message: "Failed to evaluate flags" },
			},
			500,
		);
	}
});
