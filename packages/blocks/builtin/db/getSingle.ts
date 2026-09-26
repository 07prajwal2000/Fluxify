import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { emitSort, emitWhereConditions } from "./emitConditions";
import {
	adapterFor,
	type DbSortEntry,
	dbFailure,
	dbSortSchema,
	dbWhereConditionsDescription,
	joinSchema,
	whereConditionSchema,
} from "./schema";

export const getSingleDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		tableName: z.string().describe("table name (supports js expression)"),
		conditions: z.array(whereConditionSchema).describe(dbWhereConditionsDescription),
		joins: z.array(joinSchema).default([]).optional().describe("list of joins"),
		columns: z
			.array(z.string())
			.default(["*"])
			.optional()
			.describe(
				"list of columns to select with aliases if any (e.g. column1 or table.column2 AS column2 or table.*)",
			),
		strict: z
			.boolean()
			.default(false)
			.describe(
				"fail the block when more than one row matches, instead of returning one of them; for lookups that should be unique (id, email, token)",
			),
		sort: dbSortSchema.describe(
			"which row to pick when several match, e.g. newest first: [{ attribute: 'created_at', direction: 'desc' }]. Empty: any matching row. Same rules as db_getall sort.",
		),
	})
	.extend(baseBlockDataSchema.shape);

export const getSingleDbAiDescription = {
	name: BlockTypes.db_getsingle,
	description: "Retrieves a single record from a database table.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getSingleDbBlockSchema)),
};

export async function runGetSingleDb(
	context: Context,
	connection: string,
	tableName: string,
	conditions: z.infer<typeof whereConditionSchema>[],
	options: { joins: any[]; columns: string[]; sort?: DbSortEntry[]; strict?: boolean },
) {
	try {
		return await adapterFor(context, connection).getSingle(tableName, conditions, options);
	} catch (error) {
		dbFailure("get single", error);
	}
}

/** the `lib.dbGetSingle(...)` call expression, shared with the Row Exists block */
export function emitGetSingleCall(node: EmitNode) {
	const input = getSingleDbBlockSchema.parse(node.block.data);
	return `await lib.dbGetSingle(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)}, { joins: ${JSON.stringify(input.joins ?? [])}, columns: ${JSON.stringify(input.columns ?? ["*"])}, sort: ${emitSort(input.sort, node)}, strict: ${input.strict} })`;
}

export function emitGetSingleDb(node: EmitNode) {
	return `${node.in} = ${emitGetSingleCall(node)};
${node.next()}`;
}
