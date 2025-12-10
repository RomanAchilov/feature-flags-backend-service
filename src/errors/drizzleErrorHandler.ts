import type { PostgresError } from "postgres";

export type DrizzleErrorResult = {
	status: 400 | 409;
	body: {
		error: {
			code: string;
			message: string;
		};
	};
};

/**
 * Преобразует известные ошибки PostgreSQL в структурированный HTTP-ответ.
 * Возвращает null, если ошибка не распознана.
 */
export const handleDrizzleError = (
	error: unknown,
): DrizzleErrorResult | null => {
	if (!(error instanceof Error)) {
		return null;
	}

	// Проверяем, является ли это ошибкой PostgreSQL
	const pgError = error as PostgresError;

	if (pgError.code) {
		switch (pgError.code) {
			// Unique constraint violation
			case "23505":
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
			case "23503":
				return {
					status: 400,
					body: {
						error: {
							code: "bad_request",
							message: "Invalid reference: related record not found",
						},
					},
				};

			// Not null violation
			case "23502":
				return {
					status: 400,
					body: {
						error: {
							code: "bad_request",
							message: "Required field is missing",
						},
					},
				};

			// Check constraint violation
			case "23514":
				return {
					status: 400,
					body: {
						error: {
							code: "bad_request",
							message: "Data validation failed",
						},
					},
				};

			default:
				return null;
		}
	}

	return null;
};

/**
 * Проверяет, является ли ошибка известной PostgreSQL-ошибкой,
 * которую можно безопасно показать пользователю.
 */
export const isPostgresError = (error: unknown): error is PostgresError => {
	return error instanceof Error && "code" in error;
};

/**
 * Проверяет, является ли ошибка проблемой подключения к БД.
 */
export const isConnectionError = (error: unknown): boolean => {
	if (!isPostgresError(error)) {
		return false;
	}

	// Коды ошибок подключения PostgreSQL
	const connectionErrorCodes = [
		"08000", // connection_exception
		"08003", // connection_does_not_exist
		"08006", // connection_failure
		"08001", // sqlclient_unable_to_establish_sqlconnection
		"08004", // sqlserver_rejected_establishment_of_sqlconnection
		"57P01", // admin_shutdown
		"57P02", // crash_shutdown
		"57P03", // cannot_connect_now
	];

	return connectionErrorCodes.includes(error.code || "");
};
