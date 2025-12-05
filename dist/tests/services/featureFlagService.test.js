import { describe, expect, it } from "vitest";
import {
	evaluateFeatureFlag,
	hashToPercentage,
} from "../../src/services/featureFlagService";

const baseFlag = {
	id: "flag-1",
	key: "flag-1",
	name: "Test flag",
	description: null,
	tags: [],
	type: "BOOLEAN",
	environments: [
		{
			environment: "production",
			enabled: false,
			rolloutPercentage: null,
			forceEnabled: null,
			forceDisabled: null,
			userTargets: [],
		},
	],
};
const buildFlag = (overrides = {}) => ({
	...baseFlag,
	environments: [{ ...baseFlag.environments[0], ...overrides }],
});
describe("evaluateFeatureFlag", () => {
	it("returns false when environment configuration is missing", () => {
		const flagWithoutEnv = { ...baseFlag, environments: [] };
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
		});
		const excluded = buildFlag({
			enabled: true,
			userTargets: [{ userId: "user-123", include: false }],
		});
		expect(
			evaluateFeatureFlag(targeted, "production", { id: "user-123" }),
		).toBe(true);
		expect(
			evaluateFeatureFlag(excluded, "production", { id: "user-123" }),
		).toBe(false);
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
