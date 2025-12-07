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
	tags: string[];
	type: string;
	environments: Array<{
		environment: Environment;
		enabled: boolean;
		rolloutPercentage: number | null;
		forceEnabled: boolean | null;
		forceDisabled: boolean | null;
		userTargets: Array<{
			userId: string;
			include: boolean;
		}>;
		segmentTargets: Array<{
			segment: string;
			include: boolean;
		}>;
	}>;
};
