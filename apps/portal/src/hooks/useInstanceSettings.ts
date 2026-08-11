import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";

export function useInstanceSettings() {
	const query = instanceSettingsQuery.getAll.useQuery();

	const ssoConfig = query.data?.find((s) => s.key === "sso_config")?.value as
		| { enabled?: boolean; provider?: "oidc" | "saml" }
		| undefined;

	return {
		...query,
		ssoConfig,
	};
}
