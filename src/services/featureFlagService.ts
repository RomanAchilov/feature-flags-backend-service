import type { FeatureFlagWithEnvs, Environment, UserContext } from '../domain/featureFlagTypes'

export function evaluateFeatureFlag(
  flag: FeatureFlagWithEnvs,
  environment: Environment,
  user: UserContext
): boolean {
  const envConfig = flag.environments.find((env) => env.environment === environment)

  // If no environment config, default to disabled for safety.
  if (!envConfig) {
    return false
  }

  // Overrides take highest priority.
  if (envConfig.forceEnabled === true) return true
  if (envConfig.forceDisabled === true) return false

  // User-specific targeting by userId.
  const target = envConfig.userTargets.find((t) => t.userId === user.id)
  if (target) {
    return target.include
  }

  // Percentage rollout (deterministic).
  if (envConfig.rolloutPercentage !== null && envConfig.rolloutPercentage !== undefined) {
    const bucket = hashToPercentage(`${flag.key}:${user.id}`)
    if (bucket < envConfig.rolloutPercentage) {
      return true
    }
  }

  // Default to base enabled for the environment.
  return envConfig.enabled
}

// Produces a number in [0, 100)
export function hashToPercentage(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0 // force 32-bit
  }
  const positiveHash = Math.abs(hash)
  return positiveHash % 100
}
