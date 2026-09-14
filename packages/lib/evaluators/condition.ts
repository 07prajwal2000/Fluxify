import { z } from "zod";

export const operatorSchema = z
	.enum([
		"eq",
		"neq",
		"gt",
		"gte",
		"lt",
		"lte",
		"js",
		"is_empty",
		"is_not_empty",
	])
	.describe("The operator to use for comparison");

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
	chain: z
		.enum(["and", "or"])
		.default("and")
		.describe("condition chain to use for evaluation"),
});
