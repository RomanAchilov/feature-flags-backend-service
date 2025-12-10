import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/drizzle";
import { evaluateRoute } from "../../src/routes/evaluate";
import { evaluateFeatureFlag } from "../../src/services/featureFlagService";

vi.mock("../../src/services/featureFlagService", () => ({
	evaluateFeatureFlag: vi.fn(),
}));

vi.mock("../../src/db/drizzle", () => ({
	db: {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		execute: vi.fn(),
	},
}));

const dbMock = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	from: ReturnType<typeof vi.fn>;
	where: ReturnType<typeof vi.fn>;
	execute: ReturnType<typeof vi.fn>;
};

const evaluateFeatureFlagMock = evaluateFeatureFlag as unknown as ReturnType<
	typeof vi.fn
>;

describe("evaluate route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("evaluates flags correctly", async () => {
		dbMock.execute.mockResolvedValueOnce([
			{
				id: "flag1",
				key: "test-flag",
				name: "Test Flag",
				description: null,
				type: "BOOLEAN",
				createdAt: new Date(),
				updatedAt: new Date(),
				deletedAt: null,
			},
		]);
		dbMock.execute.mockResolvedValueOnce([]);
		dbMock.execute.mockResolvedValueOnce([]);

		evaluateFeatureFlagMock.mockReturnValue(true);

		const res = await evaluateRoute.request("/", {
			method: "POST",
			body: JSON.stringify({
				environment: "development",
				user: { id: "user1" },
				flags: ["test-flag"],
			}),
			headers: { "Content-Type": "application/json" },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.flags).toEqual({ "test-flag": true });
	});
});
