import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/drizzle";
import { segmentsRoute } from "../../src/routes/segments";

vi.mock("../../src/db/drizzle", () => ({
	db: {
		select: vi.fn().mockReturnThis(),
		selectDistinct: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		returning: vi.fn(),
	},
}));

const dbMock = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	selectDistinct: ReturnType<typeof vi.fn>;
	from: ReturnType<typeof vi.fn>;
	where: ReturnType<typeof vi.fn>;
	orderBy: ReturnType<typeof vi.fn>;
	limit: ReturnType<typeof vi.fn>;
	insert: ReturnType<typeof vi.fn>;
	values: ReturnType<typeof vi.fn>;
	returning: ReturnType<typeof vi.fn>;
};

const createApp = () => {
	const app = new Hono();
	app.route("/segments", segmentsRoute);
	return app;
};

describe("segments route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns list of segments", async () => {
		dbMock.returning.mockResolvedValueOnce([{ name: "custom-segment" }]);
		dbMock.returning.mockResolvedValueOnce([{ segment: "used-segment" }]);

		const app = createApp();
		const res = await app.request("/segments");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toBeInstanceOf(Array);
	});

	it("creates new segment", async () => {
		dbMock.returning.mockResolvedValueOnce([]);
		dbMock.returning.mockResolvedValueOnce([{ name: "new-segment" }]);

		const app = createApp();
		const res = await app.request("/segments", {
			method: "POST",
			body: JSON.stringify({ name: "new-segment" }),
			headers: { "Content-Type": "application/json" },
		});

		expect(res.status).toBe(201);
	});
});
