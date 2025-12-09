import { Hono } from "hono";
import { prisma } from "../db/prisma";

// Health check endpoint (публичный, без аутентификации)
export const health = new Hono();

health.get("/", async (c) => {
	// Проверка доступности базы данных
	try {
		await prisma.$queryRaw`SELECT 1`;
	} catch (error) {
		console.error("Health check failed", error);
		return c.json({ status: "error", details: "database_unreachable" }, 500);
	}

	return c.json({ status: "ok" });
});
