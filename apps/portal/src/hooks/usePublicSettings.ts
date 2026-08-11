import { publicSettingsQuery } from "@/query/publicSettingsQuery";

export function usePublicSettings() {
	const query = publicSettingsQuery.get.useQuery();

	const ssoConfig = query.data?.sso_config;
	const authConfig = query.data?.auth_config;

	return {
		...query,
		ssoConfig,
		authConfig,
	};
}
