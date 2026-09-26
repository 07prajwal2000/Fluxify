import z from "zod";
import type { Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { emitWhereConditions } from "./emitConditions";
import { getSingleDbBlockSchema } from "./getSingle";
import { adapterFor, dbFailure, type whereConditionSchema } from "./schema";

export const countDbBlockSchema = getSingleDbBlockSchema.omit({ columns: true, sort: true });

export const countDbAiDescription = {
	name: BlockTypes.db_count,
	description:
		"Counts the records matching the conditions and outputs that number. Same params as db_getsingle, without columns. MongoDB ignores joins.",
	jsonSchema: JSON.stringify(z.toJSONSchema(countDbBlockSchema)),
};

export async function runCountDb(
	context: Context,
	connection: string,
	tableName: string,
	conditions: z.infer<typeof whereConditionSchema>[],
	options: { joins: any[] },
) {
	try {
		return await adapterFor(context, connection).count(tableName, conditions, options);
	} catch (error) {
		dbFailure("count", error);
	}
}

export function emitCountDb(node: EmitNode) {
	const input = countDbBlockSchema.parse(node.block.data);
	return `${node.in} = await lib.dbCount(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)}, { joins: ${JSON.stringify(input.joins ?? [])} });
${node.next()}`;
}
