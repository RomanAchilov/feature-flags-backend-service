import { Prisma } from "@prisma/client";

export type PrismaErrorResult = {
	status: 400 | 409;
	body: {
		error: {
			code: string;
			message: string;
		};
	};
};

/**
 * Преобразует известные ошибки Prisma в структурированный HTTP-ответ.
 * Возвращает null, если ошибка не распознана.
 */
export const handlePrismaError = (error: unknown): PrismaErrorResult | null => {
	if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
		return null;
	}

	switch (error.code) {
		// Unique constraint violation
		case "P2002":
			return {
				status: 409,
				body: {
					error: {
						code: "conflict",
						message: "Flag with this key already exists",
					},
				},
			};

		// Foreign key constraint failed
		case "P2003":
			return {
				status: 400,
				body: {
					error: {
						code: "bad_request",
						message: "Invalid reference: related record not found",
					},
				},
			};

		// Record not found (for update/delete operations)
		case "P2025":
			return {
				status: 400,
				body: {
					error: {
						code: "bad_request",
						message: "Record not found or already deleted",
					},
				},
			};

		default:
			return null;
	}
};

/**
 * Проверяет, является ли ошибка известной Prisma-ошибкой,
 * которую можно безопасно показать пользователю.
 */
export const isPrismaKnownError = (
	error: unknown,
): error is Prisma.PrismaClientKnownRequestError => {
	return error instanceof Prisma.PrismaClientKnownRequestError;
};

/**
 * Проверяет, является ли ошибка проблемой подключения к БД.
 */
export const isPrismaConnectionError = (error: unknown): boolean => {
	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		// P1001 - Can't reach database server
		// P1002 - Database server timed out
		// P1003 - Database does not exist
		return ["P1001", "P1002", "P1003"].includes(error.code);
	}
	return error instanceof Prisma.PrismaClientInitializationError;
};

