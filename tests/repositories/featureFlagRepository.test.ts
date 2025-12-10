import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/drizzle";
import { featureFlags } from "../../src/db/schema";
import { createFlag } from "../../src/repositories/featureFlagRepository";

// Интеграционные тесты - требуют подключения к БД
// Запускать с DATABASE_URL или использовать docker:db
describe.skip("featureFlagRepository (integration tests)", () => {
	describe("createFlag", () => {
		it("устанавливает createdAt и updatedAt при создании флага", async () => {
			const beforeTime = new Date();
			const result = await createFlag({
				key: `test-flag-${Date.now()}`,
				name: "Test Flag",
				description: "Test description",
			});
			const afterTime = new Date();

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(
				beforeTime.getTime(),
			);
			expect(result.createdAt.getTime()).toBeLessThanOrEqual(
				afterTime.getTime(),
			);
			expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(
				beforeTime.getTime(),
			);
			expect(result.updatedAt.getTime()).toBeLessThanOrEqual(
				afterTime.getTime(),
			);
			expect(result.createdAt.getTime()).toBe(result.updatedAt.getTime());

			// Очистка
			await db.delete(featureFlags).where(eq(featureFlags.key, result.key));
		});

		it("устанавливает createdAt и updatedAt для всех environments", async () => {
			const beforeTime = new Date();
			const result = await createFlag({
				key: `test-flag-env-${Date.now()}`,
				name: "Test Flag with Environments",
			});
			const afterTime = new Date();

			expect(result.environments.length).toBeGreaterThan(0);
			for (const env of result.environments) {
				expect(env.createdAt).toBeInstanceOf(Date);
				expect(env.updatedAt).toBeInstanceOf(Date);
				expect(env.createdAt.getTime()).toBeGreaterThanOrEqual(
					beforeTime.getTime(),
				);
				expect(env.createdAt.getTime()).toBeLessThanOrEqual(
					afterTime.getTime(),
				);
				expect(env.updatedAt.getTime()).toBeGreaterThanOrEqual(
					beforeTime.getTime(),
				);
				expect(env.updatedAt.getTime()).toBeLessThanOrEqual(
					afterTime.getTime(),
				);
				expect(env.createdAt.getTime()).toBe(env.updatedAt.getTime());
			}

			// Очистка
			await db.delete(featureFlags).where(eq(featureFlags.key, result.key));
		});

		it("создает флаг с кастомными environments и устанавливает timestamps", async () => {
			const beforeTime = new Date();
			const result = await createFlag({
				key: `test-flag-custom-${Date.now()}`,
				name: "Test Flag Custom",
				environments: [
					{ environment: "development", enabled: true },
					{ environment: "production", enabled: false },
				],
			});
			const afterTime = new Date();

			expect(result.environments).toHaveLength(2);
			for (const env of result.environments) {
				expect(env.createdAt).toBeInstanceOf(Date);
				expect(env.updatedAt).toBeInstanceOf(Date);
				expect(env.createdAt.getTime()).toBeGreaterThanOrEqual(
					beforeTime.getTime(),
				);
				expect(env.createdAt.getTime()).toBeLessThanOrEqual(
					afterTime.getTime(),
				);
			}

			// Очистка
			await db.delete(featureFlags).where(eq(featureFlags.key, result.key));
		});
	});
});
