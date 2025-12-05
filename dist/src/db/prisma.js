import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient instance in dev to avoid exhausting DB connections during hot reloads.
const globalForPrisma = globalThis;
export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		log: ["error", "warn"],
	});
if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
