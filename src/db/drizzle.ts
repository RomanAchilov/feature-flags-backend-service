import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema";

// Reuse a single connection instance in dev to avoid exhausting DB connections during hot reloads.
const globalForDrizzle = globalThis as unknown as {
	drizzle?: ReturnType<typeof drizzle>;
	connection?: postgres.Sql;
};

const connectionString = env.DATABASE_URL;

if (!connectionString) {
	throw new Error("DATABASE_URL is not set");
}

// Очищаем connection string от параметров, которые не поддерживаются postgres.js
// (например, ?schema=... из Prisma)
const cleanConnectionString = (() => {
	try {
		const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
		// Удаляем параметр schema, если он есть
		url.searchParams.delete("schema");
		return url.toString().replace(/^postgres:/, "postgresql:");
	} catch {
		// Если не удалось распарсить как URL, просто удаляем ?schema=... из строки
		return connectionString.replace(/[?&]schema=[^&]*/g, "");
	}
})();

// Создаём connection pool
const connection =
	globalForDrizzle.connection ??
	postgres(cleanConnectionString, {
		max: 10,
		onnotice: () => {},
		connection: {
			application_name: "feature-flags-backend",
		},
	});

if (process.env.NODE_ENV !== "production") {
	globalForDrizzle.connection = connection;
}

// Создаём Drizzle instance
export const db =
	globalForDrizzle.drizzle ??
	drizzle(connection, {
		schema,
		logger: process.env.NODE_ENV === "development",
	});

if (process.env.NODE_ENV !== "production") {
	globalForDrizzle.drizzle = db;
}

// Экспортируем connection для прямых запросов если нужно
export { connection };
