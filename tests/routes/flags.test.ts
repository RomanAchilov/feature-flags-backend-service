import {
	FeatureEnvironment,
	FeatureFlagAuditAction,
	FeatureFlagType,
} from "@prisma/client";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma";
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

vi.mock("../../src/db/prisma", () => ({
	prisma: {
		featureFlag: {
			findFirst: vi.fn(),
		},
		featureFlagEnvironment: {
			findMany: vi.fn(),
			update: vi.fn(),
		},
		featureFlagUserTarget: {
			createMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		featureFlagSegmentTarget: {
			createMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		featureFlagAuditLog: {
			count: vi.fn(),
		},
		$transaction: vi.fn(),
	},
}));

const prismaMock = prisma as unknown as {
	featureFlag: {
		findFirst: ReturnType<typeof vi.fn>;
	};
	featureFlagEnvironment: {
		findMany: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	};
	featureFlagUserTarget: {
		createMany: ReturnType<typeof vi.fn>;
		deleteMany: ReturnType<typeof vi.fn>;
	};
	featureFlagSegmentTarget: {
		createMany: ReturnType<typeof vi.fn>;
		deleteMany: ReturnType<typeof vi.fn>;
	};
	featureFlagAuditLog: {
		count: ReturnType<typeof vi.fn>;
	};
	$transaction: ReturnType<typeof vi.fn>;
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
	type: FeatureFlagType.BOOLEAN,
	environments: [
		{
			id: "env-1",
			environment: FeatureEnvironment.production,
			enabled: true,
			rolloutPercentage: null,
			forceEnabled: null,
			forceDisabled: null,
			userTargets: [],
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
		prismaMock.featureFlag.findFirst.mockReset();
		prismaMock.featureFlagEnvironment.findMany.mockReset();
		prismaMock.featureFlagEnvironment.update.mockReset();
		prismaMock.featureFlagUserTarget.createMany.mockReset();
		prismaMock.featureFlagUserTarget.deleteMany.mockReset();
		prismaMock.featureFlagSegmentTarget.createMany.mockReset();
		prismaMock.featureFlagSegmentTarget.deleteMany.mockReset();
		prismaMock.featureFlagAuditLog.count.mockReset();
		prismaMock.$transaction.mockReset();
		listFlagsMock.mockReset();
		createFlagMock.mockReset();
		getFlagByKeyMock.mockReset();
		updateFlagByKeyMock.mockReset();
		deleteFlagByKeyMock.mockReset();
		fetchFlagWithRelationsMock.mockReset();
		logFlagChangeMock.mockReset();
		getAuditLogForFlagMock.mockReset();

		prismaMock.$transaction.mockImplementation(
			async (callback: (client: typeof prismaMock) => unknown) =>
				typeof callback === "function" ? callback(prismaMock) : undefined,
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
			environment: FeatureEnvironment.production,
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

	it("creates a flag and returns enriched data", async () => {
		createFlagMock.mockResolvedValueOnce(sampleFlag);
		fetchFlagWithRelationsMock.mockResolvedValueOnce(sampleFlag);

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
				action: FeatureFlagAuditAction.create,
				changedBy: "tester",
				before: null,
				after: sampleFlag,
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
				action: FeatureFlagAuditAction.update,
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
		prismaMock.featureFlag.findFirst.mockResolvedValueOnce({
			id: "flag-1",
			key: "flag-1",
			environments: [
				{
					id: "env-1",
					environment: FeatureEnvironment.production,
					enabled: false,
				},
			],
		});
		prismaMock.featureFlagEnvironment.update.mockResolvedValueOnce({
			id: "env-1",
			environment: FeatureEnvironment.production,
			enabled: true,
		});

		const app = createAppWithUser();
		const res = await app.request("/flags/flag-1/environments/production", {
			method: "PATCH",
			body: JSON.stringify({ enabled: true }),
			headers: { "content-type": "application/json" },
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.enabled).toBe(true);
		expect(prismaMock.featureFlagEnvironment.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "env-1" },
				data: { enabled: true },
			}),
		);
		expect(logFlagChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				flagId: "flag-1",
				action: FeatureFlagAuditAction.update,
			}),
			expect.anything(),
		);
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
			action: FeatureFlagAuditAction.delete,
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
				action: FeatureFlagAuditAction.update,
			},
		]);
		prismaMock.featureFlagAuditLog.count.mockResolvedValueOnce(3);

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
