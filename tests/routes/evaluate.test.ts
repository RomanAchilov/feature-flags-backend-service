import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma";
import { evaluateRoute } from "../../src/routes/evaluate";
import { evaluateFeatureFlag } from "../../src/services/featureFlagService";

vi.mock("../../src/services/featureFlagService", () => ({
	evaluateFeatureFlag: vi.fn(),
}));

vi.mock("../../src/db/prisma", () => ({
	prisma: {
		featureFlag: {
			findMany: vi.fn(),
		},
	},
}));

const prismaMock = prisma as unknown as {
	featureFlag: {
		findMany: ReturnType<typeof vi.fn>;
	};
};

const evaluateFeatureFlagMock = evaluateFeatureFlag as unknown as ReturnType<
	typeof vi.fn
>;

describe("evaluate route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("evaluates provided flags using service logic", async () => {
		prismaMock.featureFlag.findMany.mockResolvedValueOnce([
			{
				id: "flag-1",
				key: "flag-1",
				name: "Flag One",
				description: null,
				tags: [],
				type: "BOOLEAN",
				environments: [
					{
						environment: "production",
						enabled: true,
						rolloutPercentage: null,
						forceEnabled: null,
						forceDisabled: null,
						userTargets: [],
						segmentTargets: [],
					},
				],
			},
		]);
		evaluateFeatureFlagMock.mockReturnValueOnce(true);

		const res = await evaluateRoute.request("/", {
			method: "POST",
			body: JSON.stringify({
				environment: "production",
				user: { id: "user-1" },
				flags: ["flag-1"],
			}),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.flags).toEqual({ "flag-1": true });
		expect(prismaMock.featureFlag.findMany).toHaveBeenCalledWith({
			where: { key: { in: ["flag-1"] }, deletedAt: null },
			include: {
				environments: {
					include: {
						userTargets: true,
						segmentTargets: { orderBy: { createdAt: "asc" } },
					},
				},
			},
		});
		expect(evaluateFeatureFlagMock).toHaveBeenCalledWith(
			expect.objectContaining({ key: "flag-1" }),
			"production",
			expect.objectContaining({ id: "user-1" }),
		);
	});

	it("returns false for missing flags", async () => {
		prismaMock.featureFlag.findMany.mockResolvedValueOnce([]);

		const res = await evaluateRoute.request("/", {
			method: "POST",
			body: JSON.stringify({
				environment: "production",
				user: { id: "user-1" },
				flags: ["missing-flag"],
			}),
			headers: { "content-type": "application/json" },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ flags: { "missing-flag": false } });
		expect(evaluateFeatureFlagMock).not.toHaveBeenCalled();
	});

	it("validates body and returns 400 on invalid input", async () => {
		const res = await evaluateRoute.request("/", {
			method: "POST",
			body: JSON.stringify({ invalid: true }),
			headers: { "content-type": "application/json" },
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error?.code).toBe("bad_request");
	});
});
