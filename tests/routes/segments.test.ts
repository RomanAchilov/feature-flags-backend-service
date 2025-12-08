import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma";
import { segmentsRoute } from "../../src/routes/segments";

vi.mock("../../src/db/prisma", () => ({
	prisma: {
		featureSegmentDefinition: {
			findMany: vi.fn(),
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		featureFlagSegmentTarget: {
			findMany: vi.fn(),
		},
	},
}));

const prismaMock = prisma as unknown as {
	featureSegmentDefinition: {
		findMany: ReturnType<typeof vi.fn>;
		findFirst: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
	};
	featureFlagSegmentTarget: {
		findMany: ReturnType<typeof vi.fn>;
	};
};

const createApp = () => {
	const app = new Hono<{ Variables: { currentUser: { id: string } } }>();
	app.use("*", async (c, next) => {
		c.set("currentUser", { id: "tester" });
		await next();
	});
	app.route("/segments", segmentsRoute);
	return app;
};

describe("segments route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.featureSegmentDefinition.findMany.mockReset();
		prismaMock.featureSegmentDefinition.findFirst.mockReset();
		prismaMock.featureSegmentDefinition.create.mockReset();
		prismaMock.featureFlagSegmentTarget.findMany.mockReset();
	});

	it("merges base, stored and used segments", async () => {
		prismaMock.featureSegmentDefinition.findMany.mockResolvedValueOnce([
			{ name: "vip" },
		]);
		prismaMock.featureFlagSegmentTarget.findMany.mockResolvedValueOnce([
			{ segment: "beta" },
		]);

		const app = createApp();
		const res = await app.request("/segments");
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual(
			expect.arrayContaining([
				{ name: "vip" },
				{ name: "beta" },
				{ name: "employee" },
			]),
		);
	});

	it("creates a new segment when it does not exist", async () => {
		prismaMock.featureSegmentDefinition.findFirst.mockResolvedValueOnce(null);
		prismaMock.featureSegmentDefinition.create.mockResolvedValueOnce({
			name: "vip",
		});
		prismaMock.featureSegmentDefinition.findMany.mockResolvedValueOnce([]);
		prismaMock.featureFlagSegmentTarget.findMany.mockResolvedValueOnce([]);

		const app = createApp();
		const res = await app.request("/segments", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "VIP" }),
		});
		const body = await res.json();

		expect(res.status).toBe(201);
		expect(body.data.name).toBe("vip");
		expect(prismaMock.featureSegmentDefinition.create).toHaveBeenCalledWith({
			data: { name: "vip" },
			select: { name: true },
		});
	});

	it("avoids creating duplicates for base or existing segments", async () => {
		prismaMock.featureSegmentDefinition.findFirst.mockResolvedValueOnce({
			name: "employee",
		});

		const app = createApp();
		const res = await app.request("/segments", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "employee" }),
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.name).toBe("employee");
		expect(prismaMock.featureSegmentDefinition.create).not.toHaveBeenCalled();
	});

	it("rejects invalid payload", async () => {
		const app = createApp();
		const res = await app.request("/segments", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "" }),
		});

		expect(res.status).toBe(400);
	});
});
