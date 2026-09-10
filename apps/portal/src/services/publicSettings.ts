import { httpClient } from "@/lib/http";

/** Mirrors `Entitlement` in `@fluxify/common/license`. */
type Entitlement = {
	status: "community" | "non_commercial" | "active" | "expired";
	canRun: boolean;
	canCreate: boolean;
	graceEndsAt: string | null;
	daysRemaining: number | null;
	/** What the license unlocks; "*" is everything. */
	features: string[];
};

const baseUrl = "/public-settings";

export type PublicSettingsResponse = {
	sso_config?: {
		provider: "oidc" | "saml";
		enabled: boolean;
		providerId: string;
		issuer?: string;
		domain?: string;
	};
	auth_config?: {
		mode: "sso_only" | "email_and_sso" | "email_only";
	};
	"featureflags.ee.connectors"?: { enabled: boolean };
	license: Entitlement;
};

export const publicSettingsService = {
	async get(): Promise<PublicSettingsResponse> {
		const result = await httpClient.get(baseUrl);
		return result.data;
	},
};
