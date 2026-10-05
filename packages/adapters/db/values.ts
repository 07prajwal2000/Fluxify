import { Decimal128, Long, ObjectId } from "mongodb";

/**
 * #512: a bigint (int8, COUNT) is a number while it's exact, otherwise its digits as
 * text. Needs the client made with `bigint: true`, or int8 comes back as text like numeric.
 */
export function exactInt(value: unknown): unknown {
	if (typeof value === "bigint") {
		const safe = value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER;
		return safe ? Number(value) : value.toString();
	}
	return Array.isArray(value) ? value.map(exactInt) : value;
}

/**
 * #512: numbers JS can't hold exactly come back as text, as on SQL: a Decimal128 always,
 * a Long only past 2^53 (the driver already makes a smaller one a number). Nested too.
 * An ObjectId comes back as its hex string, like `id` (#511).
 */
export function plainNumbers(value: unknown): unknown {
	if (value instanceof Long || value instanceof Decimal128) return value.toString();
	if (value instanceof ObjectId) return value.toHexString();
	if (Array.isArray(value)) return value.map(plainNumbers);
	if (value && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainNumbers(v)]));
	}
	return value;
}
