import { GENERAL_TAB } from "@fluxify/sdk";
import type { Param } from "@fluxify/sdk/blocks";
import { TbPlug } from "react-icons/tb";
import { type PluginParamTab, pluginParamTabs } from "@/components/integrations/pluginParamTabs";
import type { TriggerSourceOption } from "@/components/triggers/triggerForm";
import type { PluginTriggerKind } from "@/services/triggers";

/** Trigger rows of a plugin are `plugin:<kind>`; the kind is the manifest name. */
export const PLUGIN_TRIGGER_PREFIX = "plugin:";
/** Params with no declared tab land in this step, after Basics. */
export const PLUGIN_SETTINGS_TAB = "Settings";

export const isPluginTriggerType = (type: string) => type.startsWith(PLUGIN_TRIGGER_PREFIX);

export const pluginKindName = (type: string) => type.slice(PLUGIN_TRIGGER_PREFIX.length);

/** `acme/pg/poller` → `acme/pg`: the plugin a kind belongs to. */
export const pluginNameOfKind = (kind: string) => kind.split("/").slice(0, 2).join("/");

export function pluginSourceOption(kind: PluginTriggerKind): TriggerSourceOption {
	const enabled = kind.environments.development || kind.environments.production;
	return {
		id: kind.type,
		label: kind.label,
		hint: kind.description ?? `${kind.plugin} provides this trigger.`,
		icon: kind.icon ? (
			<img src={kind.icon} alt="" className="size-5 rounded object-contain" />
		) : (
			<TbPlug size={20} />
		),
		badge: "Plugin",
		available: enabled,
		disabledReason: enabled ? undefined : "Its plugin is switched off in this project.",
	};
}

/** The params that have no tab declared, shown first as the Settings step. */
export function pluginTriggerSteps(
	params: Record<string, Param>,
	tabs: readonly string[] | undefined,
	values: Record<string, unknown>,
): PluginParamTab[] {
	return pluginParamTabs(params, tabs, values).map((tab) => ({
		name: tab.name === GENERAL_TAB ? PLUGIN_SETTINGS_TAB : tab.name,
		items: tab.items,
	}));
}

/** The value a param counts as for `required`: its own, else its default (the runtime fills those). */
function effectiveValue(param: Param, values: Record<string, unknown>, name: string) {
	if (values[name] !== undefined && values[name] !== null) return values[name];
	return "default" in param ? param.default : undefined;
}

const filled = (value: unknown) => {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return true;
};

/** The required params of one step with nothing in them; the step's Next stays disabled. */
export function missingRequired(
	params: Record<string, Param>,
	names: string[],
	values: Record<string, unknown>,
): string[] {
	return names.filter((name) => {
		const param = params[name];
		if (!param || param.type === "hint" || !param.required) return false;
		return !filled(effectiveValue(param, values, name));
	});
}

/**
 * What goes in `source`: the params as typed, minus empty optionals. A secret
 * is already `cfg:<KEY>` from its picker; the server checks that shape.
 */
export function pluginSource(
	params: Record<string, Param>,
	values: Record<string, unknown>,
): Record<string, unknown> {
	const source: Record<string, unknown> = {};
	for (const [name, param] of Object.entries(params)) {
		if (param.type === "hint") continue;
		const value = values[name];
		if (value === undefined || value === null) continue;
		if (typeof value === "string" && value.trim() === "") continue;
		source[name] = value;
	}
	return source;
}

/** The `source.<param>` refusals of a save, keyed by the param they belong to. */
export function sourceFieldErrors(
	fieldErrors: { field?: string; message: string }[] | undefined,
): Record<string, string> {
	const byParam: Record<string, string> = {};
	for (const item of fieldErrors ?? []) {
		if (item.field?.startsWith("source.")) byParam[item.field.slice(7)] = item.message;
	}
	return byParam;
}

/** A param as Review shows it: a secret by its key name, never its value. */
export function paramReviewValue(param: Param, value: unknown): string {
	if (!filled(value)) return "—";
	if (param.type === "secret") return String(value).replace(/^cfg:/, "");
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(value);
}
