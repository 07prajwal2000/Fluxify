import type { VisibleWhenInput } from "./params.js";

/**
 * Whether a param shows, given the block's current values (defaults already
 * filled in). Every key of a plain `visibleWhen` must match, a value list
 * matches any of its values; `all` and `any` group. The settings panel is the
 * only caller: the one place this is decided.
 */
export function isVisible(when: VisibleWhenInput, values: Record<string, unknown>): boolean {
	if ("all" in when) return (when.all as VisibleWhenInput[]).every((w) => isVisible(w, values));
	if ("any" in when) return (when.any as VisibleWhenInput[]).some((w) => isVisible(w, values));
	return Object.entries(when).every(([name, expected]) =>
		[expected].flat().includes(values[name] as never),
	);
}
