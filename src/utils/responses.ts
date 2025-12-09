import type { Context } from "hono";

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

export type ApiError = {
	code: string;
	message: string;
	details?: unknown;
};

export type ServiceError = {
	type: "not_found" | "conflict" | "bad_request" | "internal";
	message: string;
	details?: unknown;
};

export type ServiceResult<T> =
	| { success: true; data: T }
	| { success: false; error: ServiceError };

// ─────────────────────────────────────────────────────────────────────────────
// Фабрики для ServiceResult
// ─────────────────────────────────────────────────────────────────────────────

export const ok = <T>(data: T): ServiceResult<T> => ({
	success: true,
	data,
});

export const err = <T>(error: ServiceError): ServiceResult<T> => ({
	success: false,
	error,
});

export const notFoundError = (message = "Not found"): ServiceError => ({
	type: "not_found",
	message,
});

export const conflictError = (message: string): ServiceError => ({
	type: "conflict",
	message,
});

export const badRequestError = (
	message: string,
	details?: unknown,
): ServiceError => ({
	type: "bad_request",
	message,
	details,
});

export const internalError = (message: string): ServiceError => ({
	type: "internal",
	message,
});

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы для HTTP-ответов
// ─────────────────────────────────────────────────────────────────────────────

export const badRequest = (c: Context, message: string, details?: unknown) =>
	c.json(
		{ error: { code: "bad_request", message, details } satisfies ApiError },
		400,
	);

export const notFound = (c: Context, message = "Not found") =>
	c.json({ error: { code: "not_found", message } satisfies ApiError }, 404);

export const conflict = (c: Context, message: string) =>
	c.json({ error: { code: "conflict", message } satisfies ApiError }, 409);

export const internalServerError = (c: Context, message: string) =>
	c.json({ error: { code: "internal_error", message } satisfies ApiError }, 500);

export const success = <T>(c: Context, data: T, status: 200 | 201 = 200) =>
	c.json({ data }, status);

// ─────────────────────────────────────────────────────────────────────────────
// Маппинг ServiceError → HTTP Response
// ─────────────────────────────────────────────────────────────────────────────

export const mapServiceError = (c: Context, error: ServiceError) => {
	switch (error.type) {
		case "not_found":
			return notFound(c, error.message);
		case "conflict":
			return conflict(c, error.message);
		case "bad_request":
			return badRequest(c, error.message, error.details);
		case "internal":
			return internalServerError(c, error.message);
	}
};

