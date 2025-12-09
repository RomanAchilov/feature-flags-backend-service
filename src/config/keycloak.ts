import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Конфигурация Keycloak из переменных окружения
// ─────────────────────────────────────────────────────────────────────────────

const KeycloakEnvSchema = z.object({
	KEYCLOAK_URL: z.string().url().default("http://localhost:8080"),
	KEYCLOAK_REALM: z.string().min(1).default("FeatureFlags"),
	KEYCLOAK_CLIENT_ID: z.string().min(1).default("feature-flags-api"),
	KEYCLOAK_ADMIN_ROLE: z.string().default("feature-flags-admin"),
});

const ApiKeyEnvSchema = z.object({
	// Список API ключей через запятую
	API_KEYS: z.string().default(""),
});

// ─────────────────────────────────────────────────────────────────────────────
// Парсинг конфигурации
// ─────────────────────────────────────────────────────────────────────────────

const keycloakEnv = KeycloakEnvSchema.safeParse(process.env);
const apiKeyEnv = ApiKeyEnvSchema.safeParse(process.env);

if (!keycloakEnv.success) {
	console.warn("Keycloak config warning:", keycloakEnv.error.flatten());
}

if (!apiKeyEnv.success) {
	console.warn("API Key config warning:", apiKeyEnv.error.flatten());
}

// ─────────────────────────────────────────────────────────────────────────────
// Экспорт конфигурации
// ─────────────────────────────────────────────────────────────────────────────

export const keycloakConfig = {
	serverUrl: keycloakEnv.data?.KEYCLOAK_URL ?? "http://localhost:8080",
	realm: keycloakEnv.data?.KEYCLOAK_REALM ?? "FeatureFlags",
	clientId: keycloakEnv.data?.KEYCLOAK_CLIENT_ID ?? "feature-flags-api",
	adminRole: keycloakEnv.data?.KEYCLOAK_ADMIN_ROLE ?? "feature-flags-admin",
};

export const apiKeys = (apiKeyEnv.data?.API_KEYS ?? "")
	.split(",")
	.map((k) => k.trim())
	.filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
// Флаг включения аутентификации
// ─────────────────────────────────────────────────────────────────────────────

const AuthModeSchema = z.enum(["keycloak", "dev", "none"]).default("dev");

export const authMode = AuthModeSchema.parse(
	process.env.AUTH_MODE ?? "dev",
);

/**
 * AUTH_MODE:
 * - "keycloak" — полная JWT аутентификация через Keycloak
 * - "dev" — dev-режим с заголовками x-user-id, x-user-roles (текущее поведение)
 * - "none" — без аутентификации (только для тестов)
 */

