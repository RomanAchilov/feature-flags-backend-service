import type {
	Environment,
	FeatureFlagWithEnvs,
	UserContext,
} from "../domain/featureFlagTypes";

const normalizeDigits = (value: string) => value.replace(/\D/g, "");

export const buildUserSegments = (user: UserContext): string[] => {
	const segments = new Set<string>();

	for (const segment of user.segments ?? []) {
		if (segment.trim()) {
			segments.add(segment.trim().toLowerCase());
		}
	}

	if (user.isEmployee === true) {
		segments.add("employee");
	} else if (user.isEmployee === false) {
		segments.add("non_employee");
	}

	if (user.isNewCustomer === true) {
		segments.add("new_customer");
	} else if (user.isNewCustomer === false) {
		segments.add("old_customer");
	}

	const phone =
		user.phoneNumber ||
		(typeof user.attributes?.phone === "string"
			? user.attributes.phone
			: undefined);
	if (phone) {
		const digits = normalizeDigits(phone);
		if (digits) {
			segments.add(`phone:${digits}`);
			if (digits.length >= 4) {
				segments.add(`phone-last4:${digits.slice(-4)}`);
			}
		}
	}

	const birthDateInput =
		user.birthDate ||
		(typeof user.attributes?.birthDate === "string"
			? user.attributes.birthDate
			: undefined);
	if (birthDateInput) {
		const parsed = new Date(birthDateInput);
		if (!Number.isNaN(parsed.getTime())) {
			const isoDate = parsed.toISOString().slice(0, 10);
			segments.add(`birthdate:${isoDate}`);
		}
	}

	return Array.from(segments);
};

export function evaluateFeatureFlag(
	flag: FeatureFlagWithEnvs,
	environment: Environment,
	user: UserContext,
): boolean {
	const envConfig = flag.environments.find(
		(env) => env.environment === environment,
	);

	// If no environment config, default to disabled for safety.
	if (!envConfig) {
		return false;
	}

	// Overrides take highest priority.
	if (envConfig.forceEnabled === true) return true;
	if (envConfig.forceDisabled === true) return false;

	// User-specific targeting by userId.
	const target = envConfig.userTargets.find((t) => t.userId === user.id);
	if (target) {
		return target.include;
	}

	// Segment targeting (derived and explicit).
	const userSegments = new Set(buildUserSegments(user));
	const segmentTarget = envConfig.segmentTargets.find((t) =>
		userSegments.has(t.segment.toLowerCase()),
	);
	if (segmentTarget) {
		return segmentTarget.include;
	}

	// Percentage rollout (deterministic).
	if (
		envConfig.rolloutPercentage !== null &&
		envConfig.rolloutPercentage !== undefined
	) {
		const bucket = hashToPercentage(`${flag.key}:${user.id}`);
		if (bucket < envConfig.rolloutPercentage) {
			return true;
		}
	}

	// Default to base enabled for the environment.
	return envConfig.enabled;
}

// Produces a number in [0, 100)
export function hashToPercentage(input: string): number {
	let hash = 0;
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0; // force 32-bit
	}
	const positiveHash = Math.abs(hash);
	return positiveHash % 100;
}
