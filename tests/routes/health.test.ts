import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma";
import { health } from "../../src/routes/health";

vi.mock("../../src/db/prisma", () => ({
	prisma: {
		$queryRaw: vi.fn(),
	},
}));

const prismaMock = prisma as unknown as {
	$queryRaw: ReturnType<typeof vi.fn>;
};

describe("health route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns ok when database responds", async () => {
		prismaMock.$queryRaw.mockResolvedValueOnce([{ 1: 1 }]);

		const res = await health.request("/");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
		expect(prismaMock.$queryRaw).toHaveBeenCalled();
	});

	it("returns error when database check fails", async () => {
		prismaMock.$queryRaw.mockRejectedValueOnce(new Error("db down"));

		const res = await health.request("/");
		const body = await res.json();

		expect(res.status).toBe(500);
		expect(body).toEqual({ status: "error", details: "database_unreachable" });
	});
});
