import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/drizzle";
import {
	featureFlagSegmentTargets,
	featureSegmentDefinitions,
} from "../db/schema";
import type { CurrentUser } from "../middleware/auth";

const SegmentNameSchema = z
	.string()
	.trim()
	.min(1, "Segment name is required")
	.max(128, "Segment name is too long")
	.regex(
		/^[a-zA-Z0-9._:-]+$/,
		"Only letters, numbers, dot, dash, underscore and colon are allowed",
	);

const SegmentPayloadSchema = z.object({ name: SegmentNameSchema });

const baseSegments: string[] = [
	"employee",
	"non_employee",
	"beta",
	"premium",
	"new_customer",
	"old_customer",
	"beta_tester",
] as const;

type SegmentResponse = { data: { name: string } };

const normalizeName = (value: string) => value.trim().toLowerCase();

export const segmentsRoute = new Hono<{
	Variables: { currentUser: CurrentUser };
}>();

segmentsRoute.get("/", async (c) => {
	const [defined, used] = await Promise.all([
		db
			.select({ name: featureSegmentDefinitions.name })
			.from(featureSegmentDefinitions)
			.orderBy(featureSegmentDefinitions.createdAt),
		db
			.selectDistinct({ segment: featureFlagSegmentTargets.segment })
			.from(featureFlagSegmentTargets)
			.orderBy(featureFlagSegmentTargets.segment),
	]);

	const names = Array.from(
		new Set([
			...baseSegments,
			...defined.map((item) => item.name),
			...used.map((item) => item.segment),
		]),
	);

	return c.json({ data: names.map((name) => ({ name })) });
});

segmentsRoute.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = SegmentPayloadSchema.safeParse(body);
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

	const name = normalizeName(parsed.data.name);

	if (baseSegments.includes(name)) {
		return c.json<SegmentResponse>({ data: { name } });
	}

	const existing = await db
		.select({ name: featureSegmentDefinitions.name })
		.from(featureSegmentDefinitions)
		.where(eq(featureSegmentDefinitions.name, name))
		.limit(1);

	if (existing.length > 0) {
		return c.json<SegmentResponse>({ data: { name: existing[0].name } });
	}

	const [created] = await db
		.insert(featureSegmentDefinitions)
		.values({ name })
		.returning({ name: featureSegmentDefinitions.name });

	return c.json<SegmentResponse>({ data: created }, 201);
});
