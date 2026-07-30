import { operatorSchema } from "@fluxify/lib";
import z from "zod";
import type { Context } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const whereConditionSchema = z.object({
	attribute: z.string().describe("column name / attribute name"),
	operator: operatorSchema
		.exclude(["js", "is_empty", "is_not_empty"])
		.describe("operator for comparison"),
	value: z.string().or(z.number()).describe("value"),
	chain: z.enum(["and", "or"]).describe("conditional chain"),
});

/**
 * Where conditions become a plain JS array literal. `attribute` and `value` may
 * be js expressions, so those become inlined code; everything else is baked in
 * at compile time. The adapter still builds the SQL from the result — nothing
 * about knex changes.
 */
export function emitWhereConditions(
	conditions: z.infer<typeof whereConditionSchema>[],
	node: EmitNode,
) {
	const entries = conditions.map(
		(condition) =>
			`{ attribute: ${node.value(condition.attribute)}, operator: ${JSON.stringify(condition.operator)}, value: ${node.value(condition.value)}, chain: ${JSON.stringify(condition.chain)} }`,
	);
	return `[${entries.join(", ")}]`;
}

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
