import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/drizzle";
import {
	getAuditLogForFlag,
	logFlagChange,
} from "../../src/repositories/featureFlagAuditRepository";
import {
	createFlag,
	deleteFlagByKey,
	fetchFlagWithRelations,
	getFlagByKey,
	listFlags,
	updateFlagByKey,
} from "../../src/repositories/featureFlagRepository";
import { flagsRoute } from "../../src/routes/flags";

vi.mock("../../src/repositories/featureFlagRepository", () => ({
	listFlags: vi.fn(),
	createFlag: vi.fn(),
	getFlagByKey: vi.fn(),
	updateFlagByKey: vi.fn(),
	deleteFlagByKey: vi.fn(),
	fetchFlagWithRelations: vi.fn(),
	FLAG_WITH_RELATIONS_INCLUDE: {
		environments: {
			include: {
				userTargets: true,
				segmentTargets: { orderBy: { createdAt: "asc" } },
			},
		},
		auditLogs: { orderBy: { timestamp: "desc" }, take: 5 },
	},
}));

vi.mock("../../src/repositories/featureFlagAuditRepository", () => ({
	logFlagChange: vi.fn(),
	getAuditLogForFlag: vi.fn(),
}));

vi.mock("../../src/db/drizzle", () => ({
	db: {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		count: vi.fn(),
		transaction: vi.fn(),
	},
}));

const dbMock = db as unknown as {
	select: ReturnType<typeof vi.fn>;
	from: ReturnType<typeof vi.fn>;
	where: ReturnType<typeof vi.fn>;
	count: ReturnType<typeof vi.fn>;
	transaction: ReturnType<typeof vi.fn>;
};

const listFlagsMock = listFlags as unknown as ReturnType<typeof vi.fn>;
const createFlagMock = createFlag as unknown as ReturnType<typeof vi.fn>;
const getFlagByKeyMock = getFlagByKey as unknown as ReturnType<typeof vi.fn>;
const updateFlagByKeyMock = updateFlagByKey as unknown as ReturnType<
	typeof vi.fn
>;
const deleteFlagByKeyMock = deleteFlagByKey as unknown as ReturnType<
	typeof vi.fn
>;
const fetchFlagWithRelationsMock =
	fetchFlagWithRelations as unknown as ReturnType<typeof vi.fn>;
const logFlagChangeMock = logFlagChange as unknown as ReturnType<typeof vi.fn>;
const getAuditLogForFlagMock = getAuditLogForFlag as unknown as ReturnType<
	typeof vi.fn
>;

const sampleFlag = {
	id: "flag-1",
	key: "flag-1",
	name: "My Flag",
	description: null,
	type: "BOOLEAN" as const,
	environments: [
		{
			id: "env-1",
			environment: "production" as const,
			enabled: true,
			rolloutPercentage: null,
			segmentTargets: [],
		},
	],
	auditLogs: [],
};

const createAppWithUser = () => {
	const app = new Hono<{ Variables: { currentUser: { id: string } } }>();
	app.use("*", async (c, next) => {
		c.set("currentUser", { id: "tester" });
		await next();
	});
	app.route("/flags", flagsRoute);
	return app;
};

describe("flags route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listFlagsMock.mockReset();
		createFlagMock.mockReset();
		getFlagByKeyMock.mockReset();
		updateFlagByKeyMock.mockReset();
		deleteFlagByKeyMock.mockReset();
		fetchFlagWithRelationsMock.mockReset();
		logFlagChangeMock.mockReset();
		getAuditLogForFlagMock.mockReset();

		dbMock.transaction.mockImplementation(
			async (callback: (tx: typeof dbMock) => unknown) =>
				typeof callback === "function" ? callback(dbMock) : undefined,
		);
	});

	it("lists flags with optional filters", async () => {
		listFlagsMock.mockResolvedValueOnce([sampleFlag]);

		const app = createAppWithUser();
		const res = await app.request(
			"/flags?environment=production&page=1&pageSize=5",
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toHaveLength(1);
		expect(listFlagsMock).toHaveBeenCalledWith({
			environment: "production",
			search: undefined,
			skip: 0,
			take: 5,
		});
	});

	it("rejects invalid environment query", async () => {
		const app = createAppWithUser();
		const res = await app.request("/flags?environment=unknown");

		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("bad_request");
	});

	it("returns detailed error message for NOT NULL constraint violations", async () => {
		// Симулируем ошибку NOT NULL
		const pgError = new Error("null value in column");
		(pgError as any).code = "23502";
		(pgError as any).column_name = "updatedAt";
		(pgError as any).table_name = "FeatureFlag";

		createFlagMock.mockRejectedValueOnce(pgError);

		const app = createAppWithUser();
		const res = await app.request("/flags", {
			method: "POST",
			body: JSON.stringify({
				key: "test-flag",
				name: "Test Flag",
			}),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(400);
		expect(body.error.code).toBe("bad_request");
		expect(body.error.message).toContain("updatedAt");
		expect(body.error.details).toBeDefined();
		expect(body.error.details.field).toBe("updatedAt");
		expect(body.error.details.table).toBe("FeatureFlag");
	});

	it("creates a flag and returns enriched data", async () => {
		const flagWithTimestamps = {
			...sampleFlag,
			createdAt: new Date(),
			updatedAt: new Date(),
			environments: sampleFlag.environments.map((env) => ({
				...env,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		};
		createFlagMock.mockResolvedValueOnce(flagWithTimestamps);
		fetchFlagWithRelationsMock.mockResolvedValueOnce(flagWithTimestamps);

		const app = createAppWithUser();
		const res = await app.request("/flags", {
			method: "POST",
			body: JSON.stringify({
				key: "flag-1",
				name: "My Flag",
				description: null,
			}),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(201);
		expect(body.data.key).toBe("flag-1");
		expect(logFlagChangeMock).toHaveBeenCalledWith(
			{
				flagId: "flag-1",
				action: "create",
				changedBy: "tester",
				before: null,
				after: flagWithTimestamps,
			},
			expect.anything(),
		);
	});

	it("returns 404 when flag is missing", async () => {
		fetchFlagWithRelationsMock.mockResolvedValueOnce(null);

		const app = createAppWithUser();
		const res = await app.request("/flags/missing-flag");

		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe("not_found");
	});

	it("updates a flag and logs change", async () => {
		const updatedFlag = { ...sampleFlag, name: "Updated flag" };

		// fetchFlagWithRelations вызывается дважды: для before и для hydrated после обновления
		fetchFlagWithRelationsMock
			.mockResolvedValueOnce(sampleFlag) // before
			.mockResolvedValueOnce(updatedFlag); // hydrated

		updateFlagByKeyMock.mockResolvedValueOnce(updatedFlag);

		const app = createAppWithUser();
		const res = await app.request("/flags/flag-1", {
			method: "PATCH",
			body: JSON.stringify({ name: "Updated flag" }),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.name).toBe("Updated flag");
		expect(logFlagChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				flagId: "flag-1",
				action: "update",
			}),
			expect.anything(),
		);
	});

	it("rejects patch without any fields", async () => {
		const app = createAppWithUser();
		const res = await app.request("/flags/flag-1", {
			method: "PATCH",
			body: JSON.stringify({}),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(400);
		expect(body.error.code).toBe("bad_request");
		expect(updateFlagByKeyMock).not.toHaveBeenCalled();
	});

	it("toggles environment enabled state via dedicated endpoint", async () => {
		const app = createAppWithUser();
		const res = await app.request("/flags/flag-1/environments/production", {
			method: "PATCH",
			body: JSON.stringify({ enabled: true }),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.enabled).toBe(true);
	});

	it("soft deletes a flag", async () => {
		fetchFlagWithRelationsMock.mockResolvedValueOnce(sampleFlag);
		deleteFlagByKeyMock.mockResolvedValueOnce(true);

		const app = createAppWithUser();
		const res = await app.request("/flags/flag-1", { method: "DELETE" });
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual({ deleted: true });
		expect(logFlagChangeMock).toHaveBeenCalledWith({
			flagId: "flag-1",
			action: "delete",
			changedBy: "tester",
			before: sampleFlag,
			after: null,
		});
	});

	it("returns audit logs for a flag", async () => {
		getFlagByKeyMock.mockResolvedValueOnce({ id: "flag-1", key: "flag-1" });
		getAuditLogForFlagMock.mockResolvedValueOnce([
			{
				id: "audit-1",
				flagId: "flag-1",
				action: "update",
			},
		]);
		dbMock.count.mockResolvedValueOnce([{ count: 3 }] as any);

		const app = createAppWithUser();
		const res = await app.request("/flags/flag-1/audit?page=2&pageSize=1");
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.page).toBe(2);
		expect(body.total).toBe(3);
		expect(getAuditLogForFlagMock).toHaveBeenCalledWith("flag-1", {
			skip: 1,
			take: 1,
		});
	});
});
