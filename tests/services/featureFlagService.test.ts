import { describe, expect, it } from "vitest";
import type { FeatureFlagWithEnvs } from "../../src/domain/featureFlagTypes";
import {
	evaluateFeatureFlag,
	hashToPercentage,
} from "../../src/services/featureFlagService";

const baseFlag: FeatureFlagWithEnvs = {
	id: "flag-1",
	key: "flag-1",
	name: "Test flag",
	description: null,
	type: "BOOLEAN",
	environments: [
		{
			environment: "production",
			enabled: false,
			rolloutPercentage: null,
			segmentTargets: [],
		},
	],
};

const buildFlag = (
	overrides: Partial<FeatureFlagWithEnvs["environments"][number]> = {},
) => ({
	...baseFlag,
	environments: [{ ...baseFlag.environments[0], ...overrides }],
});

describe("evaluateFeatureFlag", () => {
	describe("базовая логика", () => {
		it("возвращает false если нет конфигурации окружения", () => {
			const flagWithoutEnv: FeatureFlagWithEnvs = {
				...baseFlag,
				environments: [],
			};

			const result = evaluateFeatureFlag(flagWithoutEnv, "production", {
				id: "user-1",
			});

			expect(result).toBe(false);
		});

		it("возвращает true если флаг включен и нет правил таргетинга", () => {
			const enabledFlag = buildFlag({ enabled: true });

			expect(
				evaluateFeatureFlag(enabledFlag, "production", { id: "user-1" }),
			).toBe(true);
		});

		it("возвращает false если флаг выключен (главный рубильник)", () => {
			const disabledFlag = buildFlag({ enabled: false });

			expect(
				evaluateFeatureFlag(disabledFlag, "production", { id: "user-1" }),
			).toBe(false);
		});
	});

	describe("enabled=false - главный рубильник", () => {
		it("игнорирует segment include таргеты при enabled=false", () => {
			const flag = buildFlag({
				enabled: false,
				segmentTargets: [{ segment: "employee", include: true }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-456",
					segments: ["employee"],
				}),
			).toBe(false);
		});

		it("игнорирует rolloutPercentage при enabled=false", () => {
			const flag = buildFlag({
				enabled: false,
				rolloutPercentage: 100,
			});

			expect(evaluateFeatureFlag(flag, "production", { id: "user-1" })).toBe(
				false,
			);
		});
	});

	describe("segment targeting при enabled=true", () => {
		it("segment exclude работает", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [{ segment: "employee", include: false }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-789",
					segments: ["employee"],
				}),
			).toBe(false);
		});

		it("segment include работает (case insensitive)", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [{ segment: "employee", include: true }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-456",
					segments: ["Employee"],
				}),
			).toBe(true);
		});

		it("segment include работает как whitelist - пользователь не в сегменте не получает флаг", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [{ segment: "vip", include: true }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-regular",
					segments: [],
				}),
			).toBe(false);
		});
	});

	describe("derived segments (phone, birthdate, employee)", () => {
		it("phone сегменты работают", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [
					{ segment: "phone-prefix3:555", include: true },
					{ segment: "phone-last2:44", include: true },
				],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-001",
					phoneNumber: "+7 (555) 001-23-44",
				}),
			).toBe(true);
		});

		it("phone exclude работает", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [{ segment: "phone-last2:44", include: false }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-002",
					phoneNumber: "+7 (555) 001-23-44",
				}),
			).toBe(false);
		});

		it("birthdate сегменты работают", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [{ segment: "birthdate:1990-01-01", include: true }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-001",
					birthDate: "1990-01-01",
				}),
			).toBe(true);
		});

		it("employee и new_customer сегменты работают", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [
					{ segment: "employee", include: true },
					{ segment: "new_customer", include: true },
				],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-002",
					segments: ["employee", "new_customer"],
				}),
			).toBe(true);
		});
	});

	describe("rollout percentage при enabled=true", () => {
		it("100% раскатка включает флаг для всех", () => {
			const flag = buildFlag({
				enabled: true,
				rolloutPercentage: 100,
			});

			expect(evaluateFeatureFlag(flag, "production", { id: "user-1" })).toBe(
				true,
			);
		});

		it("0% раскатка выключает флаг для всех", () => {
			const flag = buildFlag({
				enabled: true,
				rolloutPercentage: 0,
			});

			expect(evaluateFeatureFlag(flag, "production", { id: "user-1" })).toBe(
				false,
			);
		});

		it("раскатка работает вместе с segment includes", () => {
			const flag = buildFlag({
				enabled: true,
				rolloutPercentage: 100,
				segmentTargets: [{ segment: "vip", include: true }],
			});

			// VIP пользователь получает флаг через сегмент
			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-vip",
					segments: ["vip"],
				}),
			).toBe(true);

			// Обычный пользователь получает флаг через раскатку
			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-regular",
					segments: [],
				}),
			).toBe(true);
		});
	});

	describe("комбинации правил", () => {
		it("exclude перебивает include того же уровня", () => {
			const flag = buildFlag({
				enabled: true,
				segmentTargets: [
					{ segment: "employee", include: true },
					{ segment: "contractor", include: false },
				],
			});

			// Пользователь и employee, и contractor - exclude побеждает
			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-1",
					segments: ["employee", "contractor"],
				}),
			).toBe(false);
		});

		it("segment exclude перебивает rollout", () => {
			const flag = buildFlag({
				enabled: true,
				rolloutPercentage: 100,
				segmentTargets: [{ segment: "blocked", include: false }],
			});

			expect(
				evaluateFeatureFlag(flag, "production", {
					id: "user-1",
					segments: ["blocked"],
				}),
			).toBe(false);
		});
	});
});

describe("hashToPercentage", () => {
	it("returns a stable value in the 0-99 range", () => {
		const first = hashToPercentage("flag-1:user-abc");
		const second = hashToPercentage("flag-1:user-abc");

		expect(first).toBeGreaterThanOrEqual(0);
		expect(first).toBeLessThan(100);
		expect(first).toBe(second);
	});
});
