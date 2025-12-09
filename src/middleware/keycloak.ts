import type { Context, MiddlewareHandler, Next } from "hono";
import * as jose from "jose";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Конфигурация
// ─────────────────────────────────────────────────────────────────────────────

const KeycloakConfigSchema = z.object({
	/** URL Keycloak сервера (например: http://localhost:8080) */
	serverUrl: z.string().url(),
	/** Realm name */
	realm: z.string().min(1),
	/** Client ID для верификации audience (опционально) */
	clientId: z.string().optional(),
	/** Роль админа feature flags */
	adminRole: z.string().default("feature-flags-admin"),
});

export type KeycloakConfig = z.infer<typeof KeycloakConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Типы для JWT payload от Keycloak
// ─────────────────────────────────────────────────────────────────────────────

export type KeycloakTokenPayload = {
	exp: number;
	iat: number;
	sub: string;
	iss: string;
	aud?: string | string[];
	azp?: string;
	preferred_username?: string;
	email?: string;
	email_verified?: boolean;
	name?: string;
	given_name?: string;
	family_name?: string;
	realm_access?: {
		roles: string[];
	};
	resource_access?: Record<
		string,
		{
			roles: string[];
		}
	>;
};

export type AuthenticatedUser = {
	id: string;
	email?: string;
	username?: string;
	name?: string;
	roles: string[];
	realmRoles: string[];
	clientRoles: Record<string, string[]>;
	raw: KeycloakTokenPayload;
};

// ─────────────────────────────────────────────────────────────────────────────
// JWKS кэширование
// ─────────────────────────────────────────────────────────────────────────────

const jwksCache = new Map<string, jose.JWTVerifyGetKey>();

const getJWKS = (issuerUrl: string): jose.JWTVerifyGetKey => {
	const cached = jwksCache.get(issuerUrl);
	if (cached) return cached;

	const jwksUrl = `${issuerUrl}/protocol/openid-connect/certs`;
	const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));
	jwksCache.set(issuerUrl, jwks);
	return jwks;
};

// ─────────────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────────────

const extractRoles = (
	payload: KeycloakTokenPayload,
	clientId?: string,
): {
	roles: string[];
	realmRoles: string[];
	clientRoles: Record<string, string[]>;
} => {
	const realmRoles = payload.realm_access?.roles ?? [];
	const clientRoles: Record<string, string[]> = {};

	if (payload.resource_access) {
		for (const [client, access] of Object.entries(payload.resource_access)) {
			clientRoles[client] = access.roles ?? [];
		}
	}

	// Объединяем все роли: realm + client-specific
	const allRoles = [...realmRoles];
	if (clientId && clientRoles[clientId]) {
		allRoles.push(...clientRoles[clientId]);
	}

	return { roles: allRoles, realmRoles, clientRoles };
};

const extractBearerToken = (c: Context): string | null => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return null;
	return authHeader.slice(7);
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Keycloak JWT Authentication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware для верификации JWT токенов от Keycloak.
 * Устанавливает `currentUser` в контексте при успешной аутентификации.
 */
export const keycloakAuth = (config: KeycloakConfig): MiddlewareHandler => {
	const parsed = KeycloakConfigSchema.parse(config);
	const issuerUrl = `${parsed.serverUrl}/realms/${parsed.realm}`;

	return async (c: Context, next: Next) => {
		const token = extractBearerToken(c);

		if (!token) {
			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Требуется авторизация. Передайте Bearer token.",
					},
				},
				401,
			);
		}

		try {
			const jwks = getJWKS(issuerUrl);
			const { payload } = await jose.jwtVerify(token, jwks, {
				issuer: issuerUrl,
				audience: parsed.clientId,
			});

			const keycloakPayload = payload as unknown as KeycloakTokenPayload;
			const { roles, realmRoles, clientRoles } = extractRoles(
				keycloakPayload,
				parsed.clientId,
			);

			const user: AuthenticatedUser = {
				id: keycloakPayload.sub,
				email: keycloakPayload.email,
				username: keycloakPayload.preferred_username,
				name: keycloakPayload.name,
				roles,
				realmRoles,
				clientRoles,
				raw: keycloakPayload,
			};

			c.set("currentUser", user);
			await next();
		} catch (error) {
			console.error("JWT verification failed:", error);

			if (error instanceof jose.errors.JWTExpired) {
				return c.json(
					{
						error: {
							code: "token_expired",
							message: "Токен истёк. Получите новый токен.",
						},
					},
					401,
				);
			}

			if (error instanceof jose.errors.JWTClaimValidationFailed) {
				return c.json(
					{
						error: {
							code: "invalid_token",
							message: "Недействительный токен.",
						},
					},
					401,
				);
			}

			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Ошибка авторизации.",
					},
				},
				401,
			);
		}
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Require Admin Role
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware для проверки роли администратора feature flags.
 * Должен использоваться ПОСЛЕ keycloakAuth.
 */
export const requireFeatureFlagsAdmin = (
	adminRole = "feature-flags-admin",
): MiddlewareHandler => {
	return async (c: Context, next: Next) => {
		const user = c.get("currentUser") as AuthenticatedUser | undefined;

		if (!user) {
			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Пользователь не аутентифицирован.",
					},
				},
				401,
			);
		}

		if (!user.roles.includes(adminRole)) {
			return c.json(
				{
					error: {
						code: "forbidden",
						message: "Требуется роль администратора feature flags.",
						requiredRole: adminRole,
						userRoles: user.roles,
					},
				},
				403,
			);
		}

		await next();
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: API Key для клиентских приложений
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware для проверки API ключа клиентского приложения.
 * Используется для публичных эндпоинтов типа /evaluate.
 *
 * API ключ передаётся в заголовке X-API-Key.
 */
export const apiKeyAuth = (validApiKeys: string[]): MiddlewareHandler => {
	const keySet = new Set(validApiKeys);

	return async (c: Context, next: Next) => {
		const apiKey = c.req.header("X-API-Key");

		if (!apiKey) {
			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Требуется API ключ. Передайте X-API-Key заголовок.",
					},
				},
				401,
			);
		}

		if (!keySet.has(apiKey)) {
			return c.json(
				{
					error: {
						code: "unauthorized",
						message: "Недействительный API ключ.",
					},
				},
				401,
			);
		}

		// Устанавливаем минимальный контекст пользователя для совместимости
		c.set("currentUser", {
			id: `api-key:${apiKey.slice(0, 8)}...`,
			roles: ["api-client"],
		});

		await next();
	};
};

// ─────────────────────────────────────────────────────────────────────────────
// Опциональная аутентификация (для эндпоинтов с mixed access)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware который пытается аутентифицировать, но не блокирует при отсутствии токена.
 * Полезно для эндпоинтов, которые работают и для анонимов, и для авторизованных.
 */
export const optionalKeycloakAuth = (
	config: KeycloakConfig,
): MiddlewareHandler => {
	const parsed = KeycloakConfigSchema.parse(config);
	const issuerUrl = `${parsed.serverUrl}/realms/${parsed.realm}`;

	return async (c: Context, next: Next) => {
		const token = extractBearerToken(c);

		if (!token) {
			// Нет токена — пропускаем без аутентификации
			c.set("currentUser", null);
			await next();
			return;
		}

		try {
			const jwks = getJWKS(issuerUrl);
			const { payload } = await jose.jwtVerify(token, jwks, {
				issuer: issuerUrl,
				audience: parsed.clientId,
			});

			const keycloakPayload = payload as unknown as KeycloakTokenPayload;
			const { roles, realmRoles, clientRoles } = extractRoles(
				keycloakPayload,
				parsed.clientId,
			);

			c.set("currentUser", {
				id: keycloakPayload.sub,
				email: keycloakPayload.email,
				username: keycloakPayload.preferred_username,
				name: keycloakPayload.name,
				roles,
				realmRoles,
				clientRoles,
				raw: keycloakPayload,
			});
		} catch {
			// Невалидный токен — пропускаем без аутентификации
			c.set("currentUser", null);
		}

		await next();
	};
};

