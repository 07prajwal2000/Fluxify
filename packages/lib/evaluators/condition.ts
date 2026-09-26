import { z } from "zod";

export const operatorSchema = z
	.enum(["eq", "neq", "gt", "gte", "lt", "lte", "js", "is_empty", "is_not_empty"])
	.describe("The operator to use for comparison");

/** operators that compare against nothing, so a condition using one has no value */
export const DB_VALUELESS_OPERATORS = ["is_null", "is_not_null", "exists", "not_exists"] as const;

/**
 * The database WHERE operators. Kept apart from `operatorSchema`: the if block
 * shares that one, and `between` or `starts_with` would mean nothing there.
 */
export const dbOperatorSchema = z
	.enum([
		"eq",
		"neq",
		"gt",
		"gte",
		"lt",
		"lte",
		"in",
		"not_in",
		"contains",
		"starts_with",
		"ends_with",
		"between",
		...DB_VALUELESS_OPERATORS,
	])
	.describe(
		"eq/neq/gt/gte/lt/lte compare; in/not_in take a list (array or comma-separated text); between takes [min, max], both included; contains/starts_with/ends_with match text, ignoring case; is_null/is_not_null and exists/not_exists (MongoDB only) take no value.",
	);

export type DbOperator = z.infer<typeof dbOperatorSchema>;

export const conditionSchema = z.object({
	// if it is prefixed with `js:` then it will use vm which is created for the request's context
	lhs: z
		.string()
		.or(z.number().or(z.boolean()))
		.describe("left-hand side operator (can be js expression)"),
	rhs: z
		.string()
		.or(z.number().or(z.boolean()))
		.describe("right-hand side operator (can be js expression)"),
	operator: operatorSchema,
	js: z.string().optional().describe("javascript expression"),
	chain: z.enum(["and", "or"]).default("and").describe("condition chain to use for evaluation"),
});
