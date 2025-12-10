import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/drizzle";
import { health } from "../../src/routes/health";

vi.mock("../../src/db/drizzle", () => ({
	db: {
		execute: vi.fn(),
	},
}));

const dbMock = db as unknown as {
	execute: ReturnType<typeof vi.fn>;
};

describe("health route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns ok when database responds", async () => {
		dbMock.execute.mockResolvedValueOnce([{ "?column?": 1 }]);

		const res = await health.request("/");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
		expect(dbMock.execute).toHaveBeenCalled();
	});

	it("returns error when database check fails", async () => {
		dbMock.execute.mockRejectedValueOnce(new Error("db down"));

		const res = await health.request("/");
		const body = await res.json();

		expect(res.status).toBe(500);
		expect(body).toEqual({ status: "error", details: "database_unreachable" });
	});
});
