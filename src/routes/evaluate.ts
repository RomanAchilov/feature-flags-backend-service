import { FeatureEnvironment } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db/prisma";
import type {
	Environment,
	FeatureFlagWithEnvs,
	UserContext,
} from "../domain/featureFlagTypes";
import type { CurrentUser } from "../middleware/auth";
import { evaluateFeatureFlag } from "../services/featureFlagService";

const EvaluateSchema = z.object({
	environment: z.nativeEnum(FeatureEnvironment),
	user: z.object({
		id: z.string().min(1),
		role: z.string().optional(),
		country: z.string().optional(),
		segments: z.array(z.string().min(1)).optional(),
		isEmployee: z.boolean().optional(),
		isNewCustomer: z.boolean().optional(),
		phoneNumber: z.string().optional(),
		birthDate: z.string().optional(),
		attributes: z.record(z.string(), z.unknown()).optional(),
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
		const foundFlags = await prisma.featureFlag.findMany({
			where: { key: { in: flags }, deletedAt: null },
			include: {
				environments: {
					include: {
						userTargets: true,
						segmentTargets: {
							orderBy: { createdAt: "asc" },
						},
					},
				},
			},
		});

		const domainFlags: Record<string, FeatureFlagWithEnvs> = {};
		for (const flag of foundFlags) {
			domainFlags[flag.key] = {
				id: flag.id,
				key: flag.key,
				name: flag.name,
				description: flag.description,
				type: flag.type,
				environments: flag.environments.map((env) => ({
					environment: env.environment as Environment,
					enabled: env.enabled,
					rolloutPercentage: env.rolloutPercentage,
					forceEnabled: env.forceEnabled,
					forceDisabled: env.forceDisabled,
					userTargets: env.userTargets.map((target) => ({
						userId: target.userId,
						include: target.include,
					})),
					segmentTargets:
						env.segmentTargets?.map((target) => ({
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
