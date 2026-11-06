import type { NumberParam } from "./params.js";

/**
 * The trigger setting a plugin's `lag` adds. Its name is fixed and it lives in
 * the trigger's `source` beside the author's params, so no param may take it.
 */
export const LAG_PER_WORKER = "lagPerWorker";

/** the longest `lag.helpText`, which the trigger form shows under the field */
export const MAX_LAG_HELP_TEXT = 200;

/** the settings tab the field shows in, after the author's own */
export const LAG_TAB = "Scaling";

/** `lag` as the manifest holds it: the definition minus `read` */
export type LagEntry = { default?: number; helpText: string };

/**
 * The field a trigger form draws for a kind that defines `lag`, as a param, so
 * the form, its review and the server's checks all treat it like any other. A
 * kind with no default makes it required: nothing fills it in for the user.
 */
export function lagPerWorkerParam(lag: LagEntry): NumberParam {
	return {
		type: "number",
		label: "Lag per worker",
		description: lag.helpText,
		min: 1,
		integer: true,
		tab: LAG_TAB,
		...(lag.default === undefined ? { required: true } : { default: lag.default }),
	};
}
