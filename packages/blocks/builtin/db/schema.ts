import { DB_VALUELESS_OPERATORS, dbOperatorSchema } from "@fluxify/lib";
import z from "zod";
import type { Context } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

/**
 * Makes a condition side name a column instead of holding a value. Each side
 * tags only what it is *not* by default — an attribute is a column, a value is
 * a literal — so an untagged side never changes meaning and a dotted string
 * like an email address can never be mistaken for a column path.
 */
export const columnRefSchema = z.object({
	kind: z.literal("column"),
	value: z.string().describe("column name / json path to compare against"),
});

export const literalRefSchema = z.object({
	kind: z.literal("literal"),
	value: z
		.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())])
		.describe("value to compare against; a list for in / not_in / between"),
});

export const dbWhereConditionsDescription =
	"Database WHERE clause. Always emit an array of condition objects; never emit plain strings or if-block conditions. Structured condition: attribute and value are tagged objects, e.g. { attribute: { kind: 'column', value: 'status' }, operator: 'eq', value: { kind: 'literal', value: 'active' }, chain: 'and' }. Lists: { operator: 'in', value: { kind: 'literal', value: \"js:return getRequestBody().ids\" } } (or 'a,b,c' text); between takes [min, max]; is_null / is_not_null take no value. Conditions combine strictly left to right (no AND-before-OR), so when mixing and/or use a group for brackets: a AND (b OR c) is [a, { group: [b, c with chain 'or'], chain: 'and' }]; groups nest. When the fixed operators cannot express it (JSON/array operators, full-text search...), use a custom condition: { operator: 'raw', raw, chain } — see the raw field. A condition whose value is undefined at run time is skipped (null is kept), so optional filters need no branching: value { kind: 'literal', value: \"js:getQueryParam('status')\" } filters only when the query param was sent. A group whose conditions are all skipped is skipped too.";

const CHAIN_DESCRIPTION =
	"How this condition joins everything before it in its list (ignored on the first).";

export const dbConditionSideSchema = z.discriminatedUnion("kind", [
	columnRefSchema,
	literalRefSchema,
]);

export const rawWhereConditionSchema = z.object({
	operator: z
		.literal("raw")
		.describe("custom condition written by hand, for what the fixed operators cannot express"),
	raw: z
		.string()
		.describe(
			"SQL databases (PostgreSQL, MySQL): a boolean SQL expression. Put run-time values in {{ }} — each is a JS expression sent as a bound parameter, never pasted into the SQL, e.g. \"tags @> {{ input.tags }}\" — for a list of values use the in operator instead. The condition is skipped when any {{ }} value is undefined. MongoDB: 'js:' code returning a MongoDB query filter object, e.g. \"js:return { name: { $regex: getQueryParam('q'), $options: 'i' } }\"; returning undefined skips it.",
		),
	chain: z.enum(["and", "or"]).describe(CHAIN_DESCRIPTION),
});

const structuredWhereConditionSchema = z
	.object({
		attribute: dbConditionSideSchema.describe(
			"Required DB condition-side object: { kind: 'column', value: 'table.column' } or { kind: 'literal', value }. Never a bare string or number.",
		),
		operator: dbOperatorSchema,
		value: dbConditionSideSchema
			.optional()
			.describe(
				"DB condition-side object: { kind: 'literal', value } or { kind: 'column', value: 'table.column' }. Never a bare string or number. Leave out for is_null / is_not_null / exists / not_exists.",
			),
		chain: z.enum(["and", "or"]).describe(CHAIN_DESCRIPTION),
	})
	.superRefine((condition, context) => {
		const valueless = (DB_VALUELESS_OPERATORS as readonly string[]).includes(condition.operator);
		if (!valueless && !condition.value) {
			context.addIssue({
				code: "custom",
				message: `The ${condition.operator} operator needs a value.`,
				path: ["value"],
			});
		}
		if (
			condition.attribute.kind === "literal" &&
			(valueless || condition.value?.kind !== "column")
		) {
			context.addIssue({
				code: "custom",
				message: "A database WHERE condition must reference at least one column.",
				path: ["value"],
			});
		}
	});

export type WhereCondition =
	| z.infer<typeof structuredWhereConditionSchema>
	| z.infer<typeof rawWhereConditionSchema>
	| { group: WhereCondition[]; chain: "and" | "or" };

export const whereConditionSchema: z.ZodType<WhereCondition> = z.union([
	structuredWhereConditionSchema,
	rawWhereConditionSchema,
	z.object({
		get group() {
			return z
				.array(whereConditionSchema)
				.describe(
					"brackets: these conditions combine first, left to right, then join the outer list as one condition",
				);
		},
		chain: z.enum(["and", "or"]).describe(CHAIN_DESCRIPTION),
	}),
]);

/**
 * ORDER BY as a list: the first entry sorts first, the next breaks its ties.
 * Graphs saved before the list stored one `{ attribute, direction }` object;
 * that still loads, as a list of one.
 */
export const dbSortSchema = z
	.preprocess(
		(sort) => (sort && typeof sort === "object" && !Array.isArray(sort) ? [sort] : sort),
		z.array(
			z.object({
				attribute: z
					.string()
					.describe(
						"column or JSON path to sort by (supports js expression); 'id' on MongoDB is _id",
					),
				direction: z.enum(["asc", "desc"]),
			}),
		),
	)
	.default([])
	.describe(
		"ORDER BY entries, first entry sorts first. The table's primary key (_id on MongoDB) is always added last, so rows that tie come back in a fixed order. An entry whose column is undefined at run time is skipped, e.g. \"js:getQueryParam('sortBy')\".",
	);

export type DbSortEntry = z.infer<typeof dbSortSchema>[number];

/** every db block resolves its adapter the same way */
export function adapterFor(context: Context, connection: string) {
	return context.dbFactory!.getDbAdapter(connection);
}

/** keeps the interpreted blocks' error text while preserving the real cause */
export function dbFailure(block: string, error: unknown): never {
	throw new Error(`failed to execute ${block} db block`, { cause: error });
}

export const joinSchema = z.object({
	table: z.string().describe("table to join"),
	alias: z.string().optional().describe("alias for the table"),
	attribute: z
		.string()
		.describe("attribute to join e.g. table1.id = table2.id")
		.refine((val) => {
			const parts = val.split("=");
			return parts.length === 2;
		}, "attribute must be in the format of table1.id = table2.id"),
	type: z.enum(["inner", "left", "right", "outer"]).default("inner").describe("type of join"),
});
