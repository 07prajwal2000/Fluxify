import { pluginParamProblems } from "../canvas/panel/blocks/pluginParamProblems";
import { isConfigEmpty } from "./EnvironmentIntegrationFields";
import { pluginParamsOf } from "./pluginParamTabs";

/**
 * Whether a plugin connector's config holds something the server refuses, in
 * production or in the development config that is its own: such a form is not
 * saved or tested until it is fixed. A connector drawn by a built-in form has
 * no params here, so never blocks.
 */
export function pluginConfigInvalid(
	meta: Parameters<typeof pluginParamsOf>[0],
	config: Record<string, unknown>,
	devConfig: Record<string, unknown> | null,
	syncDev: boolean,
) {
	const params = pluginParamsOf(meta);
	if (!params) return false;
	const own = !syncDev && devConfig && !isConfigEmpty(devConfig) ? devConfig : null;
	return [config, own].some((c) => c && Object.keys(pluginParamProblems(params, c)).length > 0);
}
