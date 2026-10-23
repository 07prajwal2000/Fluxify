import type { z } from "zod";
import type { Param } from "./params.js";
import { checkParams, type Issue } from "./validate.js";
import { CONFIG_PARAM_TYPES } from "./validateIntegration.js";

/**
 * The param types a trigger takes: what a form holds, plus the integration and
 * app config pickers. Nothing evaluated per request: a trigger has no request.
 */
export const TRIGGER_PARAM_TYPES: readonly string[] = [
	...CONFIG_PARAM_TYPES,
	"integration",
	"appconfig",
];

/** the words `visibleWhen` groups by; `__`-prefixed names are the runtime's too */
export const RESERVED_TRIGGER_PARAM_NAMES: readonly string[] = ["all", "any"];

/** fields only a block has; a trigger declaring one was likely copied from a block */
export const BLOCK_ONLY_FIELDS = ["run", "handles", "shape", "invoke"] as const;

type Entry = {
	params: Record<string, Param>;
	permissions: { integrations?: string[]; appconfig?: boolean };
	tabs?: string[];
};

/** The rules of a trigger manifest entry no single field can check: its params, as a block's. */
export function checkTriggerEntry(e: Entry, ctx: z.RefinementCtx) {
	const issue: Issue = (message, path) => ctx.addIssue({ code: "custom", message, path });
	checkParams(e, RESERVED_TRIGGER_PARAM_NAMES, issue);
	for (const [name, p] of Object.entries(e.params)) {
		if (name.startsWith("__")) issue(`param name '${name}' is reserved (__*)`, ["params", name]);
		if (!TRIGGER_PARAM_TYPES.includes(p.type))
			issue(`param '${name}': a trigger cannot take a ${p.type} param; it has no request`, [
				"params",
				name,
			]);
	}
}
