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

export const getAllDbBlockSchema = z
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
		limit: z.int().or(z.string()).default(1000).describe("limit (supports js expressions)"),
		offset: z.int().or(z.string()).default(0).describe("skip count (supports js expressions)"),
		sort: dbSortSchema,
	})
	.extend(baseBlockDataSchema.shape);

export const getAllDbAiDescription = {
	name: BlockTypes.db_getall,
	description: "Retrieves multiple records from a database table.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getAllDbBlockSchema)),
};

export async function runGetAllDb(
	context: Context,
	connection: string,
	tableName: string,
	conditions: z.infer<typeof whereConditionSchema>[],
	limit: number,
	offset: number,
	sort: DbSortEntry[],
	options: { joins: any[]; columns: string[] },
) {
	try {
		return await adapterFor(context, connection).getAll(
			tableName,
			conditions,
			limit,
			offset,
			sort,
			options,
		);
	} catch (error) {
		dbFailure("get all", error);
	}
}

export function emitGetAllDb(node: EmitNode) {
	const input = getAllDbBlockSchema.parse(node.block.data);
	return `${node.in} = await lib.dbGetAll(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)}, lib.num(${node.value(input.limit)}, 1000), lib.num(${node.value(input.offset)}, 0), ${emitSort(input.sort, node)}, { joins: ${JSON.stringify(input.joins ?? [])}, columns: ${JSON.stringify(input.columns ?? ["*"])} });
${node.next()}`;
}
