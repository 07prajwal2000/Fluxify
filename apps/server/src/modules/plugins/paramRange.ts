import type { Param } from "@fluxify/sdk/blocks";

/**
 * A number param's bounds changed (the rule blocks, triggers and integration
 * configs share): the line the diff lists, and whether a stored value no longer
 * fits. Widening, or adding a bound every value already meets, breaks nothing.
 */

type Bounds = { min?: number; max?: number; integer?: boolean };
type NumberParam = Extract<Param, { type: "number" }>;

const boundsOf = (p: NumberParam): Bounds => ({
	min: p.min,
	max: p.max,
	integer: !!p.integer,
});

const same = (a: Bounds, b: Bounds) =>
	a.min === b.min && a.max === b.max && !!a.integer === !!b.integer;

/** whether a stored value fits; a value of another type is the type check's business, not this one */
export function fitsRange(bounds: Bounds, value: unknown) {
	if (typeof value !== "number") return true;
	if (bounds.integer && !Number.isInteger(value)) return false;
	if (bounds.min !== undefined && value < bounds.min) return false;
	if (bounds.max !== undefined && value > bounds.max) return false;
	return true;
}

const describe = ({ min, max, integer }: Bounds) => {
	const numbers = integer ? "whole numbers" : "numbers";
	if (min !== undefined && max !== undefined) return `${numbers} from ${min} to ${max}`;
	if (min !== undefined) return `${numbers} of at least ${min}`;
	if (max !== undefined) return `${numbers} of at most ${max}`;
	return integer ? "whole numbers" : "any number";
};

export function rangeChange(name: string, before?: Param, after?: Param) {
	if (before?.type !== "number" || after?.type !== "number") return undefined;
	const was = boundsOf(before);
	const now = boundsOf(after);
	if (same(was, now)) return undefined;
	return {
		change: `param ${name} now takes ${describe(now)}`,
		/** a stored value falls outside the new bounds */
		drops: (value: unknown) => !fitsRange(now, value),
	};
}
