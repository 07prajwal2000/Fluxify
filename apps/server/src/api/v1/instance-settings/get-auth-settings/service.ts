import { redactSecrets } from "../../../../lib/instance-settings/schemas";
import { getInstanceSettingByKey } from "../upsert/repository";

export default async function handleRequest() {
	const [authRow, ssoRow] = await Promise.all([
		getInstanceSettingByKey("auth_config"),
		getInstanceSettingByKey("sso_config"),
	]);
	const mode = (authRow?.value as { mode?: string } | undefined)?.mode;

	return {
		type: mode === "sso_only" ? "sso" : "traditional",
		sso_config: redactSecrets((ssoRow?.value as Record<string, unknown>) ?? {}),
	};
}
