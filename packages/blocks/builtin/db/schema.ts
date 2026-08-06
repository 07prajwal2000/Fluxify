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
	value: z
		.union([z.string(), z.number(), z.boolean()])
		.describe("value to compare against"),
});

export const dbWhereConditionsDescription =
	"Database WHERE clause. Always emit an array of condition objects; never emit strings, SQL snippets, or if-block conditions. Each attribute and value must be a tagged object. Example: [{ attribute: { kind: 'column', value: 'status' }, operator: 'eq', value: { kind: 'literal', value: 'active' }, chain: 'and' }].";

export const dbConditionSideSchema = z.discriminatedUnion("kind", [
	columnRefSchema,
	literalRefSchema,
]);

export const whereConditionSchema = z
	.object({
	attribute: dbConditionSideSchema
		.describe(
			"Required DB condition-side object: { kind: 'column', value: 'table.column' } or { kind: 'literal', value }. Never a bare string or number.",
		),
	operator: operatorSchema
		.exclude(["js", "is_empty", "is_not_empty"])
		.describe("Database comparison operator, for example eq, neq, gt, gte, lt, lte."),
	value: dbConditionSideSchema
		.describe("Required DB condition-side object: { kind: 'literal', value } or { kind: 'column', value: 'table.column' }. Never a bare string or number."),
	chain: z.enum(["and", "or"]).describe("How this condition joins to next WHERE condition."),
	})
	.superRefine((condition, context) => {
		if (
			condition.attribute.kind === "literal" &&
			condition.value.kind === "literal"
		) {
			context.addIssue({
				code: "custom",
				message: "A database WHERE condition must reference at least one column.",
				path: ["value"],
			});
		}
	});

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
	type: z
		.enum(["inner", "left", "right", "outer"])
		.default("inner")
		.describe("type of join"),
});
