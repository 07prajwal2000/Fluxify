import type { IDbAdapter } from "@fluxify/adapters";
import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import { type EmitNode, emitJsObject } from "../../compiler";
import { emitWhereConditions } from "./emitConditions";
import {
	adapterFor,
	dbFailure,
	dbWhereConditionsDescription,
	whereConditionSchema,
} from "./schema";

export const updateDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		tableName: z.string().describe("table name (supports js expression)"),
		conditions: z.array(whereConditionSchema).describe(dbWhereConditionsDescription),
		data: z.object({
			source: z.enum(["raw", "js"]).describe("source of the value"),
			value: z
				.object()
				.or(z.string().describe("value to insert (object values can be js expression as string)")),
		}),
		useParam: z.boolean().describe("use parameter"),
	})
	.extend(baseBlockDataSchema.shape);

export const updateDbAiDescription = {
	name: BlockTypes.db_update,
	description: "Updates records in a database table matching specific conditions.",
	jsonSchema: JSON.stringify(z.toJSONSchema(updateDbBlockSchema)),
};

export async function runUpdateDb(
	context: Context,
	connection: string,
	tableName: string,
	data: object,
	conditions: z.infer<typeof whereConditionSchema>[],
) {
	try {
		return await adapterFor(context, connection).update(tableName, data, conditions);
	} catch (error) {
		dbFailure("update", error);
	}
}

/** read without parsing — `data.value` is `z.object()`, which strips every key */
export function emitUpdateDb(node: EmitNode) {
	const input = node.block.data as z.infer<typeof updateDbBlockSchema>;
	const data = node.v("data");
	const value = input.data.value;

	let payload: string;
	if (input.useParam) {
		payload = node.in;
	} else if (input.data.source === "js" && typeof value === "string") {
		payload = node.js(value, node.in);
	} else {
		payload = emitJsObject(value, node);
	}

	return `const ${data} = ${payload};
if (typeof ${data} !== "object") throw new Error("error in update: data to update is not an object");
${node.in} = await lib.dbUpdate(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${data}, ${emitWhereConditions(input.conditions, node)});
${node.next()}`;
}
