import { operatorSchema } from "@fluxify/lib";
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
	value: z.union([z.string(), z.number(), z.boolean()]).describe("value to compare against"),
});

export const dbWhereConditionsDescription =
	"Database WHERE clause. Always emit an array of condition objects; never emit plain strings or if-block conditions. Structured condition: attribute and value are tagged objects, e.g. { attribute: { kind: 'column', value: 'status' }, operator: 'eq', value: { kind: 'literal', value: 'active' }, chain: 'and' }. When the fixed operators cannot express it (ILIKE, IN, BETWEEN, JSON/array operators, $regex...), use a custom condition: { operator: 'raw', raw, chain } — see the raw field. A condition whose value is undefined at run time is skipped (null is kept), so optional filters need no branching: value { kind: 'literal', value: \"js:getQueryParam('status')\" } filters only when the query param was sent.";

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
			"SQL databases (PostgreSQL, MySQL): a boolean SQL expression. Put run-time values in {{ }} — each is a JS expression sent as a bound parameter, never pasted into the SQL, e.g. \"name ILIKE {{ '%' + getQueryParam('q') + '%' }}\" or \"status IN ({{ input.a }}, {{ input.b }})\". The condition is skipped when any {{ }} value is undefined. MongoDB: 'js:' code returning a MongoDB query filter object, e.g. \"js:return { name: { $regex: getQueryParam('q'), $options: 'i' } }\"; returning undefined skips it.",
		),
	chain: z.enum(["and", "or"]).describe("How this condition joins to next WHERE condition."),
});

const structuredWhereConditionSchema = z
	.object({
		attribute: dbConditionSideSchema.describe(
			"Required DB condition-side object: { kind: 'column', value: 'table.column' } or { kind: 'literal', value }. Never a bare string or number.",
		),
		operator: operatorSchema
			.exclude(["js", "is_empty", "is_not_empty"])
			.describe("Database comparison operator, for example eq, neq, gt, gte, lt, lte."),
		value: dbConditionSideSchema.describe(
			"Required DB condition-side object: { kind: 'literal', value } or { kind: 'column', value: 'table.column' }. Never a bare string or number.",
		),
		chain: z.enum(["and", "or"]).describe("How this condition joins to next WHERE condition."),
	})
	.superRefine((condition, context) => {
		if (condition.attribute.kind === "literal" && condition.value.kind === "literal") {
			context.addIssue({
				code: "custom",
				message: "A database WHERE condition must reference at least one column.",
				path: ["value"],
			});
		}
	});

export const whereConditionSchema = z.union([
	structuredWhereConditionSchema,
	rawWhereConditionSchema,
]);

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
