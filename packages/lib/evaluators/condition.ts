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

const CHAIN_DESCRIPTION =
	"how this condition joins everything before it; conditions combine strictly left to right. Ignored on the first condition of a list or group";

const leafConditionSchema = z
	.object({
		// if it is prefixed with `js:` then it will use vm which is created for the request's context
		lhs: z
			.string()
			.or(z.number().or(z.boolean()))
			.optional()
			.describe("left-hand side operator (can be js expression). Required except for operator js"),
		rhs: z
			.string()
			.or(z.number().or(z.boolean()))
			.optional()
			.describe(
				"right-hand side operator (can be js expression). Required for eq/neq/gt/gte/lt/lte; omit for is_empty, is_not_empty and js",
			),
		operator: operatorSchema,
		js: z.string().optional().describe("javascript expression"),
		chain: z.enum(["and", "or"]).default("and").describe(CHAIN_DESCRIPTION),
	})
	.superRefine((c, ctx) => {
		const needsLhs = c.operator !== "js";
		const needsRhs = needsLhs && c.operator !== "is_empty" && c.operator !== "is_not_empty";
		if (needsLhs && c.lhs === undefined)
			ctx.addIssue({ code: "custom", path: ["lhs"], message: `lhs is required for ${c.operator}` });
		if (needsRhs && c.rhs === undefined)
			ctx.addIssue({ code: "custom", path: ["rhs"], message: `rhs is required for ${c.operator}` });
	});

export type ConditionGroup = { group: Condition[]; chain: "and" | "or" };
export type Condition = z.infer<typeof leafConditionSchema> | ConditionGroup;

// group first: a leaf object would strip `group` and silently parse a group as a leaf
export const conditionSchema: z.ZodType<Condition> = z.union([
	z.object({
		get group() {
			return z
				.array(conditionSchema)
				.describe(
					"brackets: these conditions combine first, left to right, then join the outer list as one condition",
				);
		},
		chain: z.enum(["and", "or"]).default("and").describe(CHAIN_DESCRIPTION),
	}),
	leafConditionSchema,
]);
