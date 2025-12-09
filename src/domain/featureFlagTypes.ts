export type Environment = "development" | "staging" | "production";

export interface UserContext {
	id: string;
	segments?: string[];
	phoneNumber?: string;
	birthDate?: string;
}

export type FeatureFlagWithEnvs = {
	id: string;
	key: string;
	name: string;
	description?: string | null;
	type: string;
	environments: Array<{
		environment: Environment;
		enabled: boolean;
		rolloutPercentage: number | null;
		segmentTargets: Array<{
			segment: string;
			include: boolean;
		}>;
	}>;
};
