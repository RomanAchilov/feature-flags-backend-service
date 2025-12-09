import type { Context, MiddlewareHandler, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Конфигурация
// ─────────────────────────────────────────────────────────────────────────────

const CorsConfigSchema = z.object({
	origins: z.array(z.string()).default(["*"]),
	credentials: z.boolean().default(false),
});

const RateLimitConfigSchema = z.object({
	windowMs: z.number().default(60_000),
	limit: z.number().default(100),
});

const SecurityConfigSchema = z.object({
	cors: CorsConfigSchema.default({ origins: ["*"], credentials: false }),
	rateLimit: RateLimitConfigSchema.default({ windowMs: 60_000, limit: 100 }),
	bodyLimit: z.number().default(100 * 1024), // 100KB
	timeout: z.number().default(30_000), // 30 секунд
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting (используем hono-rate-limiter)
// ─────────────────────────────────────────────────────────────────────────────

type RateLimitOptions = {
	/** Окно времени в миллисекундах (по умолчанию 60 секунд) */
	windowMs?: number;
	/** Максимальное количество запросов за окно (по умолчанию 100) */
	limit?: number;
	/** Сообщение при превышении лимита */
	message?: string;
};

/**
 * Rate limiting middleware на базе hono-rate-limiter.
 * Поддерживает стандартные заголовки RateLimit-* (draft-6).
 *
 * Для production с несколькими инстансами рекомендуется использовать
 * внешнее хранилище (Redis) через параметр `store`.
 */
export const rateLimit = (
	options: RateLimitOptions = {},
): MiddlewareHandler => {
	const {
		windowMs = 60_000,
		limit = 100,
		message = "Слишком много запросов. Попробуйте позже.",
	} = options;

	return rateLimiter({
		windowMs,
		limit,
		standardHeaders: "draft-6",
		keyGenerator: (c) =>
			c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown",
		handler: (c) =>
			c.json(
				{
					error: {
						code: "rate_limit_exceeded",
						message,
					},
				},
				429,
			),
	});
};

// ─────────────────────────────────────────────────────────────────────────────
// Role-Based Access Control (RBAC)
// ─────────────────────────────────────────────────────────────────────────────

export const requireRole = (...allowedRoles: string[]): MiddlewareHandler => {
	return async (c: Context, next: Next) => {
		const user = c.get("currentUser");
		const userRoles = user?.roles ?? [];

		const hasRole = allowedRoles.some((role) => userRoles.includes(role));

		if (!hasRole) {
			return c.json(
				{
					error: {
						code: "forbidden",
						message: "Недостаточно прав для выполнения операции",
						requiredRoles: allowedRoles,
					},
				},
				403,
			);
		}

		await next();
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Secure Headers
// ─────────────────────────────────────────────────────────────────────────────

export const securityHeaders = (): MiddlewareHandler => {
	return secureHeaders({
		xFrameOptions: "DENY",
		xContentTypeOptions: "nosniff",
		referrerPolicy: "strict-origin-when-cross-origin",
		strictTransportSecurity: "max-age=31536000; includeSubDomains",
		xXssProtection: "1; mode=block",
	});
};

// ─────────────────────────────────────────────────────────────────────────────
// CORS Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const corsMiddleware = (
	origins: string[] = ["*"],
	credentials = false,
): MiddlewareHandler => {
	return cors({
		origin: origins,
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
		exposeHeaders: [
			"RateLimit-Limit",
			"RateLimit-Remaining",
			"RateLimit-Reset",
			"X-Request-ID",
		],
		credentials,
		maxAge: 600,
	});
};

// ─────────────────────────────────────────────────────────────────────────────
// Body Limit
// ─────────────────────────────────────────────────────────────────────────────

export const bodyLimitMiddleware = (
	maxSize = 100 * 1024,
): MiddlewareHandler => {
	return bodyLimit({
		maxSize,
		onError: (c) =>
			c.json(
				{
					error: {
						code: "payload_too_large",
						message: "Размер тела запроса превышает допустимый лимит",
						maxSize,
					},
				},
				413,
			),
	});
};

// ─────────────────────────────────────────────────────────────────────────────
// Request Timeout
// ─────────────────────────────────────────────────────────────────────────────

export const timeoutMiddleware = (ms = 30_000): MiddlewareHandler => {
	return timeout(ms);
};

// ─────────────────────────────────────────────────────────────────────────────
// Request ID
// ─────────────────────────────────────────────────────────────────────────────

export const requestId = (): MiddlewareHandler => {
	return async (c: Context, next: Next) => {
		const id = c.req.header("x-request-id") ?? crypto.randomUUID();
		c.set("requestId", id);
		c.res.headers.set("X-Request-ID", id);
		await next();
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Combined Security Stack
// ─────────────────────────────────────────────────────────────────────────────

export const createSecurityStack = (config?: Partial<SecurityConfig>) => {
	const parsed = SecurityConfigSchema.parse(config ?? {});

	return {
		securityHeaders: securityHeaders(),
		cors: corsMiddleware(parsed.cors.origins, parsed.cors.credentials),
		bodyLimit: bodyLimitMiddleware(parsed.bodyLimit),
		timeout: timeoutMiddleware(parsed.timeout),
		rateLimit: rateLimit({
			windowMs: parsed.rateLimit.windowMs,
			limit: parsed.rateLimit.limit,
		}),
		requestId: requestId(),
	};
};
