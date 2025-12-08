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
			forceEnabled: null,
			forceDisabled: null,
			userTargets: [],
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
	it("returns false when environment configuration is missing", () => {
		const flagWithoutEnv: FeatureFlagWithEnvs = {
			...baseFlag,
			environments: [],
		};

		const result = evaluateFeatureFlag(flagWithoutEnv, "production", {
			id: "user-1",
		});

		expect(result).toBe(false);
	});

	it("honors force enable and disable overrides", () => {
		const forcedOn = buildFlag({ forceEnabled: true, enabled: false });
		const forcedOff = buildFlag({ forceDisabled: true, enabled: true });

		expect(evaluateFeatureFlag(forcedOn, "production", { id: "user-1" })).toBe(
			true,
		);
		expect(evaluateFeatureFlag(forcedOff, "production", { id: "user-1" })).toBe(
			false,
		);
	});

	it("prefers user targets over other rules", () => {
		const targeted = buildFlag({
			enabled: false,
			userTargets: [{ userId: "user-123", include: true }],
			segmentTargets: [{ segment: "employee", include: false }],
		});
		const excluded = buildFlag({
			enabled: true,
			userTargets: [{ userId: "user-123", include: false }],
			segmentTargets: [{ segment: "employee", include: true }],
		});

		expect(
			evaluateFeatureFlag(targeted, "production", { id: "user-123" }),
		).toBe(true);
		expect(
			evaluateFeatureFlag(excluded, "production", { id: "user-123" }),
		).toBe(false);
	});

	it("matches segment targets when provided", () => {
		const targeted = buildFlag({
			enabled: false,
			segmentTargets: [{ segment: "employee", include: true }],
		});
		const excluded = buildFlag({
			enabled: true,
			segmentTargets: [{ segment: "employee", include: false }],
		});

		expect(
			evaluateFeatureFlag(targeted, "production", {
				id: "user-456",
				segments: ["Employee"],
			}),
		).toBe(true);
		expect(
			evaluateFeatureFlag(excluded, "production", {
				id: "user-789",
				segments: ["employee"],
			}),
		).toBe(false);
	});

	it("derives segments from user attributes for phone and birthdate", () => {
		const targeted = buildFlag({
			enabled: false,
			segmentTargets: [
				{ segment: "phone-prefix3:555", include: true },
				{ segment: "phone-last2:44", include: true },
				{ segment: "birthdate:1990-01-01", include: true },
			],
		});

		expect(
			evaluateFeatureFlag(targeted, "production", {
				id: "user-001",
				phoneNumber: "+7 (555) 001-23-44",
				birthDate: "1990-01-01",
			}),
		).toBe(true);

		const excluded = buildFlag({
			enabled: true,
			segmentTargets: [{ segment: "phone-last2:44", include: false }],
		});

		expect(
			evaluateFeatureFlag(excluded, "production", {
				id: "user-002",
				phoneNumber: "+7 (555) 001-23-44",
			}),
		).toBe(false);
	});

	it("derives employee and new customer segments from booleans", () => {
		const targeted = buildFlag({
			enabled: false,
			segmentTargets: [
				{ segment: "employee", include: true },
				{ segment: "new_customer", include: true },
			],
		});

		expect(
			evaluateFeatureFlag(targeted, "production", {
				id: "user-002",
				isEmployee: true,
				isNewCustomer: true,
			}),
		).toBe(true);
	});

	it("uses rollout percentage when provided", () => {
		const alwaysOnRollout = buildFlag({
			enabled: false,
			rolloutPercentage: 100,
		});
		const alwaysOffRollout = buildFlag({
			enabled: false,
			rolloutPercentage: 0,
		});

		expect(
			evaluateFeatureFlag(alwaysOnRollout, "production", { id: "user-1" }),
		).toBe(true);
		expect(
			evaluateFeatureFlag(alwaysOffRollout, "production", { id: "user-1" }),
		).toBe(false);
	});

	it("falls back to environment enabled flag when no overrides match", () => {
		const enabledFlag = buildFlag({ enabled: true });

		expect(
			evaluateFeatureFlag(enabledFlag, "production", { id: "user-1" }),
		).toBe(true);
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
