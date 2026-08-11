import { httpClient } from "@/lib/http";

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
};

export const publicSettingsService = {
	async get(): Promise<PublicSettingsResponse> {
		const result = await httpClient.get(baseUrl);
		return result.data;
	},
};
