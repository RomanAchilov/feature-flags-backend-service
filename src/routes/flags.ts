import { FeatureEnvironment, Prisma } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db/prisma";
import type { CurrentUser } from "../middleware/auth";
import { validateFlagKey } from "../middleware/validateFlagKey";
import { getAuditLogForFlag } from "../repositories/featureFlagAuditRepository";
import { getFlagByKey, listFlags } from "../repositories/featureFlagRepository";
import {
	CreateFlagSchema,
	PaginationSchema,
	ToggleEnvironmentSchema,
	UpdateFlagSchema,
} from "../schemas/flag.schema";
import {
	createFlagWithTargets,
	getFlagByKeyWithRelations,
	softDeleteFlag,
	toggleFlagEnvironment,
	updateFlagWithTargets,
} from "../services/flagCrudService";
import {
	badRequest,
	internalServerError,
	mapServiceError,
	notFound,
	success,
} from "../utils/responses";

// ─────────────────────────────────────────────────────────────────────────────
// Типы и инициализация
// ─────────────────────────────────────────────────────────────────────────────

type FlagsVariables = {
	currentUser: CurrentUser;
	flagKey?: string;
};

export const flagsRoute = new Hono<{ Variables: FlagsVariables }>();

// ─────────────────────────────────────────────────────────────────────────────
// GET /flags - Список флагов
// ─────────────────────────────────────────────────────────────────────────────

flagsRoute.get("/", async (c) => {
	const environment = c.req.query("environment");
	const search = c.req.query("search") ?? undefined;
	const page = Number.parseInt(c.req.query("page") ?? "1", 10);
	const pageSize = Number.parseInt(c.req.query("pageSize") ?? "20", 10);

	// Валидация environment
	let envFilter: FeatureEnvironment | undefined;
	if (environment) {
		if (
			!Object.values(FeatureEnvironment).includes(
				environment as FeatureEnvironment,
			)
		) {
			return badRequest(c, "Invalid environment");
		}
		envFilter = environment as FeatureEnvironment;
	}

	const skip = page > 0 ? (page - 1) * pageSize : 0;

	try {
		const flags = await listFlags({
			environment: envFilter,
			search,
			skip,
			take: pageSize,
		});
		return success(c, flags);
	} catch (error) {
		console.error("Failed to list flags", error);
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			return success(c, []);
		}
		return internalServerError(c, "Failed to list flags");
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /flags - Создание флага
// ─────────────────────────────────────────────────────────────────────────────

flagsRoute.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = CreateFlagSchema.safeParse(body);

	if (!parsed.success) {
		return badRequest(c, "Invalid body", parsed.error.flatten());
	}

	const result = await createFlagWithTargets(
		parsed.data,
		c.get("currentUser").id ?? "system",
	);

	if (!result.success) {
		return mapServiceError(c, result.error);
	}

	return success(c, result.data, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// Подроутер для маршрутов с :key (middleware выполняется один раз)
// ─────────────────────────────────────────────────────────────────────────────

const flagByKeyRoutes = new Hono<{ Variables: FlagsVariables }>();

// Middleware валидации ключа — выполняется один раз для всех вложенных маршрутов
flagByKeyRoutes.use("*", validateFlagKey);

// GET /flags/:key - Получение флага
flagByKeyRoutes.get("/", async (c) => {
	const key = c.get("flagKey") as string;
	const result = await getFlagByKeyWithRelations(key);

	if (!result.success) {
		return mapServiceError(c, result.error);
	}

	return success(c, result.data);
});

// PATCH /flags/:key - Обновление флага
flagByKeyRoutes.patch("/", async (c) => {
	const key = c.get("flagKey") as string;
	const body = await c.req.json().catch(() => null);
	const parsed = UpdateFlagSchema.safeParse(body);

	if (!parsed.success) {
		return badRequest(c, "Invalid body", parsed.error.flatten());
	}

	const result = await updateFlagWithTargets(
		key,
		parsed.data,
		c.get("currentUser").id ?? "system",
	);

	if (!result.success) {
		return mapServiceError(c, result.error);
	}

	return success(c, result.data);
});

// DELETE /flags/:key - Удаление флага (soft delete)
flagByKeyRoutes.delete("/", async (c) => {
	const key = c.get("flagKey") as string;

	const result = await softDeleteFlag(key, c.get("currentUser").id ?? "system");

	if (!result.success) {
		return mapServiceError(c, result.error);
	}

	return success(c, result.data);
});

// GET /flags/:key/audit - Аудит-лог флага
flagByKeyRoutes.get("/audit", async (c) => {
	const key = c.get("flagKey") as string;

	const paginationParsed = PaginationSchema.safeParse({
		page: c.req.query("page") ?? "1",
		pageSize: c.req.query("pageSize") ?? "20",
	});

	if (!paginationParsed.success) {
		return badRequest(c, "Invalid pagination", paginationParsed.error.flatten());
	}

	const { page, pageSize } = paginationParsed.data;
	const skip = (page - 1) * pageSize;

	try {
		const flag = await getFlagByKey(key);
		if (!flag) {
			return notFound(c, "Flag not found");
		}

		const [items, total] = await Promise.all([
			getAuditLogForFlag(flag.id, { skip, take: pageSize }),
			prisma.featureFlagAuditLog.count({ where: { flagId: flag.id } }),
		]);

		return c.json({ data: items, page, pageSize, total });
	} catch (error) {
		console.error("Failed to get audit log", error);
		return internalServerError(c, "Failed to get audit log");
	}
});

// PATCH /flags/:key/environments/:environment - Переключение окружения
flagByKeyRoutes.patch("/environments/:environment", async (c) => {
	const key = c.get("flagKey") as string;

	const environmentParsed = z
		.nativeEnum(FeatureEnvironment)
		.safeParse(c.req.param("environment"));

	if (!environmentParsed.success) {
		return badRequest(c, "Invalid environment", environmentParsed.error.flatten());
	}

	const body = await c.req.json().catch(() => null);
	const parsed = ToggleEnvironmentSchema.safeParse(body);

	if (!parsed.success) {
		return badRequest(c, "Invalid body", parsed.error.flatten());
	}

	const result = await toggleFlagEnvironment(
		key,
		environmentParsed.data,
		parsed.data.enabled,
		c.get("currentUser").id ?? "system",
	);

	if (!result.success) {
		return mapServiceError(c, result.error);
	}

	return success(c, result.data);
});

// Монтируем подроутер на /:key
flagsRoute.route("/:key", flagByKeyRoutes);
