import { isVisible, paramTabs } from "@fluxify/sdk";
import type { Param } from "@fluxify/sdk/blocks";

export type PluginParamTab = { name: string; items: string[] };

/**
 * The params (and hints) `visibleWhen` shows, by tab; a tab with no shown param
 * is gone, whatever hints it has. Defaults count as values, because the runtime
 * fills them where the form left the param empty.
 */
export function pluginParamTabs(
	params: Record<string, Param>,
	tabs: readonly string[] | undefined,
	data: Record<string, unknown>,
): PluginParamTab[] {
	const values: Record<string, unknown> = {};
	for (const [name, p] of Object.entries(params)) if ("default" in p) values[name] = p.default;
	for (const [name, value] of Object.entries(data)) if (value != null) values[name] = value;
	const shown = (name: string) => {
		const when = params[name]?.visibleWhen;
		return !when || isVisible(when, values);
	};
	return paramTabs(params, tabs)
		.map((tab) => ({ name: tab.name, items: tab.params.filter(shown) }))
		.filter((tab) => tab.items.some((name) => params[name]?.type !== "hint"));
}
