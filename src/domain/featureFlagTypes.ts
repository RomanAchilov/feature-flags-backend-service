export type Environment = "development" | "staging" | "production";

export interface UserContext {
	id: string;
	role?: string;
	country?: string;
	segments?: string[];
	isEmployee?: boolean;
	isNewCustomer?: boolean;
	phoneNumber?: string;
	birthDate?: string;
	attributes?: Record<string, unknown>;
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
