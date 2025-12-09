import type {
	Environment,
	FeatureFlagWithEnvs,
	UserContext,
} from "../domain/featureFlagTypes";

const normalizeDigits = (value: string) => value.replace(/\D/g, "");

export const buildUserSegments = (user: UserContext): string[] => {
	const segments = new Set<string>();

	// Прямые сегменты (vip, beta, employee и т.д.)
	for (const segment of user.segments ?? []) {
		if (segment.trim()) {
			segments.add(segment.trim().toLowerCase());
		}
	}

	// Сегменты из номера телефона
	if (user.phoneNumber) {
		const digits = normalizeDigits(user.phoneNumber);
		if (digits) {
			segments.add(`phone:${digits}`);
			if (digits.length >= 2) {
				segments.add(`phone-last2:${digits.slice(-2)}`);
			}
			if (digits.length >= 3) {
				const prefix =
					digits.startsWith("7") && digits.length >= 4
						? digits.slice(1, 4)
						: digits.slice(0, 3);
				if (prefix.length === 3) {
					segments.add(`phone-prefix3:${prefix}`);
				}
			}
			if (digits.length >= 4) {
				segments.add(`phone-last4:${digits.slice(-4)}`);
			}
		}
	}

	// Сегмент из даты рождения
	if (user.birthDate) {
		const parsed = new Date(user.birthDate);
		if (!Number.isNaN(parsed.getTime())) {
			const isoDate = parsed.toISOString().slice(0, 10);
			segments.add(`birthdate:${isoDate}`);
		}
	}

	return Array.from(segments);
};

/**
 * Evaluates whether a feature flag is enabled for a given user.
 *
 * Приоритет правил:
 * 1. enabled=false → false (ГЛАВНЫЙ РУБИЛЬНИК - флаг выключен для всех)
 * 2. segment exclude → false
 * 3. segment include → true
 * 4. rollout percentage → hash check
 * 5. default: если есть include-правила → false (whitelist), иначе → true
 */
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

	// 1. Main switch - if disabled, flag is off for everyone.
	// Это главный рубильник: выключен = выключен для всех.
	if (!envConfig.enabled) {
		return false;
	}

	// --- Далее enabled=true, применяем таргетинг ---

	const userSegments = new Set(buildUserSegments(user));

	// 2. Check segment excludes (высший приоритет)
	const segmentExclude = envConfig.segmentTargets.find(
		(t) => !t.include && userSegments.has(t.segment.toLowerCase()),
	);
	if (segmentExclude) return false;

	// 3. Check segment includes
	const hasIncludeSegments = envConfig.segmentTargets.some((t) => t.include);
	if (hasIncludeSegments) {
		const segmentInclude = envConfig.segmentTargets.find(
			(t) => t.include && userSegments.has(t.segment.toLowerCase()),
		);
		if (segmentInclude) return true;
		// User is not in any include segment - check rollout next
	}

	// 4. Percentage rollout (deterministic).
	if (
		envConfig.rolloutPercentage !== null &&
		envConfig.rolloutPercentage !== undefined
	) {
		const bucket = hashToPercentage(`${flag.key}:${user.id}`);
		return bucket < envConfig.rolloutPercentage;
	}

	// 5. Default: если есть include-сегменты, это whitelist - пользователь не в списке
	if (hasIncludeSegments) {
		return false;
	}

	// 6. Если нет никаких include-правил - флаг включен для всех
	return true;
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
