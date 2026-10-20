import type { z } from "zod";
import type { HandleSpec } from "./handles.js";
import { COMPARABLE_TYPES, type Param, type VisibleWhenInput } from "./params.js";
import { type InvokeMode, MODULE_BLOCK_DATA_KEYS } from "./reserved.js";
import { GENERAL_TAB } from "./tabs.js";

/** the engine's own data keys, and the words `visibleWhen` groups by */
export const RESERVED_PARAM_NAMES: readonly string[] = [...MODULE_BLOCK_DATA_KEYS, "all", "any"];

type Entry = {
	params: Record<string, Param>;
	handles: HandleSpec;
	invoke: InvokeMode[];
	permissions: { integrations?: string[]; appconfig?: boolean };
	tabs?: string[];
};
type Issue = (message: string, path: (string | number)[]) => void;

/** a value a param can hold, for comparing in `visibleWhen` */
function fits(p: Param, value: unknown) {
	if (p.type === "select") return p.options.includes(value as string);
	return typeof value === p.type;
}

function checkVisible(
	params: Entry["params"],
	when: VisibleWhenInput,
	path: (string | number)[],
	issue: Issue,
) {
	if ("all" in when || "any" in when) {
		const key = "all" in when ? "all" : "any";
		const group = ("all" in when ? when.all : when.any) as VisibleWhenInput[];
		for (const [i, w] of group.entries()) checkVisible(params, w, [...path, key, i], issue);
		return;
	}
	for (const [name, expected] of Object.entries(when)) {
		const target = Object.hasOwn(params, name) ? params[name] : undefined;
		if (!target)
			issue(`visibleWhen names '${name}', which is not a param of this block`, [...path, name]);
		else if (!COMPARABLE_TYPES.includes(target.type))
			issue(`visibleWhen cannot compare '${name}': a ${target.type} param`, [...path, name]);
		else
			for (const value of [expected].flat())
				if (!fits(target, value))
					issue(`visibleWhen value ${JSON.stringify(value)} does not fit param '${name}'`, [
						...path,
						name,
					]);
	}
}

/**
 * The rules no single field can check: params against each other and the
 * permissions, invoke modes against the handles.
 */
export function checkEntry(entry: Entry, ctx: z.RefinementCtx) {
	const issue: Issue = (message, path) => ctx.addIssue({ code: "custom", message, path });
	const { params, handles, invoke, permissions, tabs } = entry;
	for (const [name, p] of Object.entries(params)) {
		if (RESERVED_PARAM_NAMES.includes(name))
			issue(`param name '${name}' is reserved (${RESERVED_PARAM_NAMES.join(", ")})`, [
				"params",
				name,
			]);
		if (p.visibleWhen) checkVisible(params, p.visibleWhen, ["params", name, "visibleWhen"], issue);
		if (p.type === "integration" && !permissions.integrations?.includes(p.kind))
			issue(
				`param '${name}' picks a ${p.kind} integration, so permissions.integrations must list '${p.kind}'`,
				["params", name],
			);
		if (p.type === "appconfig" && !permissions.appconfig)
			issue(`param '${name}' reads app config, so permissions.appconfig must be true`, [
				"params",
				name,
			]);
	}
	// a hint alone shows nothing to set, so it does not make a tab worth having
	const used = new Set(
		Object.values(params).map((p) => (p.type === "hint" ? undefined : (p.tab ?? GENERAL_TAB))),
	);
	for (const [i, tab] of (tabs ?? []).entries())
		if (!used.has(tab)) issue(`tabs lists '${tab}', which no param uses`, ["tabs", i]);
	// the caller never learns the outcome of an async or queued call, so there is no branch to take
	const detached = invoke.filter((m) => m !== "sync");
	if (handles.out.length === 2 && detached.length)
		issue(
			`a block with success/failure outputs can only be invoked sync, not ${detached.join(", ")}`,
			["invoke"],
		);
	// only a sync call has a run to hand `executeHandle` to
	if (handles.body.length && !invoke.includes("sync"))
		issue("a block with body handles must allow sync invoke: only a sync call can run them", [
			"invoke",
		]);
}
