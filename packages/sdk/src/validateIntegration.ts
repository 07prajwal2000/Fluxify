import type { z } from "zod";
import {
	BUILT_IN_DB_TYPES,
	BUILT_IN_VARIANT_NAMES,
	isBuiltInIntegrationGroup,
	isIntegrationGroupName,
	parseIntegrationKind,
} from "./integrations/variants.js";
import type { Param } from "./params.js";
import { checkTabs, checkVisible, type Issue } from "./validate.js";

/** the param types an integration's config takes: what a form holds, nothing evaluated per request */
export const CONFIG_PARAM_TYPES = [
	"string",
	"number",
	"boolean",
	"select",
	"json",
	"secret",
	"keyValue",
	"array",
	"hint",
] as const;

/** the fields the worker sets on every cached config, beside the `__`-prefixed ones */
export const RESERVED_CONFIG_NAMES: readonly string[] = [
	"group",
	"variant",
	"dbType",
	"queryTimeoutMs",
	"maxConnections",
];

/** a plugin's own group, before the runtime puts it under the plugin's scope */
export const LOCAL_GROUP = /^[a-z0-9][a-z0-9-]*$/;

type Entry = {
	name: string;
	group: string;
	variant: string;
	extras?: Record<string, unknown>;
	configSchema: Record<string, Param>;
	tabs?: string[];
	secretParams: string[];
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** a variant of a built-in group takes none of its built-in names; a database brings its own dbType and editor */
function checkBuiltInVariant(group: keyof typeof BUILT_IN_VARIANT_NAMES, e: Entry, issue: Issue) {
	if (BUILT_IN_VARIANT_NAMES[group].some((v) => same(v, e.variant)))
		issue(`variant '${e.variant}' is taken by a built-in ${group} variant`, ["variant"]);
	if (group !== "database") return;
	const { dbType, conditionEditor } = e.extras ?? {};
	if (typeof dbType !== "string" || !dbType)
		issue("a database variant needs extras.dbType", ["extras", "dbType"]);
	else if (BUILT_IN_DB_TYPES.some((t) => same(t, dbType)))
		issue(`extras.dbType '${dbType}' is taken by a built-in database`, ["extras", "dbType"]);
	if (conditionEditor !== "sql" && conditionEditor !== "js")
		issue("a database variant needs extras.conditionEditor: 'sql' or 'js'", [
			"extras",
			"conditionEditor",
		]);
}

function checkGroup(e: Entry, issue: Issue) {
	if (isBuiltInIntegrationGroup(e.group)) return checkBuiltInVariant(e.group, e, issue);
	const scope = e.name.split("/")[0]!;
	const [namespace, local, ...rest] = e.group.split("/");
	if (namespace !== scope || !local || rest.length)
		issue(`group '${e.group}' must be a built-in group or '${scope}/<group>'`, ["group"]);
	else if (isBuiltInIntegrationGroup(local.toLowerCase()))
		issue(
			`group '${local}' shadows the built-in group '${local.toLowerCase()}': write group '${local.toLowerCase()}' for a variant of it, or pick another name`,
			["group"],
		);
	else if (!LOCAL_GROUP.test(local))
		issue(`group '${local}' must be lowercase letters, digits and -`, ["group"]);
	else if (!isIntegrationGroupName(e.group))
		issue(`scope '${scope}' is a built-in group name, so it cannot hold a group`, ["group"]);
}

/**
 * A block's `permissions.integrations` kind: a built-in group or a variant of
 * one, or one of this plugin's own groups (`acme/crm`, `acme/crm/Hub`). Another
 * plugin's kinds are refused until plugins can depend on each other (#899).
 * `own` holds the namespaced groups the plugin declares; undefined skips that check.
 */
export function permissionKindIssue(kind: string, own?: ReadonlySet<string>) {
	const parsed = parseIntegrationKind(kind);
	if (!parsed)
		return `'${kind}' is not an integration kind: write a built-in group (kv, database, ...) or '<scope>/<group>'`;
	if (own && !isBuiltInIntegrationGroup(parsed.group) && !own.has(parsed.group))
		return `'${kind}' is not one of this plugin's own integration groups (${[...own].join(", ") || "none"}); another plugin's kinds are not supported yet`;
	return undefined;
}

/**
 * An integration param's `variants`: each a variant of the kind's group that
 * Fluxify ships (a name or an alias) or this plugin provides. A kind that
 * already names a variant (`kv/Redis`) takes no `variants`.
 */
export function variantsIssue(
	kind: string,
	variants: readonly string[],
	provided: readonly { group: string; variant: string }[],
) {
	const parsed = parseIntegrationKind(kind);
	if (!parsed) return undefined; // the permission check names a bad kind
	if (parsed.variant !== undefined)
		return `kind '${kind}' names a variant already; write kind '${parsed.group}' to list variants`;
	const { group } = parsed;
	const known = [
		...(isBuiltInIntegrationGroup(group) ? BUILT_IN_VARIANT_NAMES[group] : []),
		...provided.filter((p) => p.group === group).map((p) => p.variant),
	];
	const unknown = variants.filter((v) => !known.includes(v));
	if (unknown.length)
		return `${unknown.map((v) => `'${v}'`).join(", ")} ${unknown.length > 1 ? "are not variants" : "is not a variant"} of ${group}; known: ${known.join(", ") || "none"}`;
	return undefined;
}

/** The rules of an integration manifest entry no single field can check. */
export function checkIntegrationEntry(e: Entry, ctx: z.RefinementCtx) {
	const issue: Issue = (message, path) => ctx.addIssue({ code: "custom", message, path });
	const params = e.configSchema;
	for (const [name, p] of Object.entries(params)) {
		if (name.startsWith("__") || RESERVED_CONFIG_NAMES.includes(name))
			issue(`config name '${name}' is reserved (${RESERVED_CONFIG_NAMES.join(", ")}, __*)`, [
				"configSchema",
				name,
			]);
		if (!(CONFIG_PARAM_TYPES as readonly string[]).includes(p.type))
			issue(
				p.type === "appconfig"
					? `config '${name}': an integration reads app config through param.secret()`
					: `config '${name}': an integration's config cannot take a ${p.type} param`,
				["configSchema", name],
			);
		if (p.visibleWhen)
			checkVisible(params, p.visibleWhen, ["configSchema", name, "visibleWhen"], issue);
	}
	checkTabs(params, e.tabs, issue);
	const secrets = Object.keys(params).filter((k) => params[k]!.type === "secret");
	if (secrets.join("\0") !== e.secretParams.join("\0"))
		issue(`secretParams must be the secret params: ${secrets.join(", ") || "none"}`, [
			"secretParams",
		]);
	checkGroup(e, issue);
}
