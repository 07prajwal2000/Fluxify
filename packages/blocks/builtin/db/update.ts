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

const COUNTER =
	'a column value can be { op: "inc" | "dec", value: number } to add to / subtract from what the database holds, safe when runs overlap, e.g. { "points": { "op": "inc", "value": 10 } }; value may be a js expression but must evaluate to a number';

export const updateDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		tableName: z.string().describe("table name (supports js expression)"),
		conditions: z.array(whereConditionSchema).describe(dbWhereConditionsDescription),
		data: z.object({
			source: z.enum(["raw", "js"]).describe("source of the value"),
			value: z
				.record(z.string(), z.unknown())
				.or(z.string().describe("value to insert (object values can be js expression as string)"))
				.describe(`columns to set; ${COUNTER}`),
		}),
		useParam: z.boolean().describe("use parameter"),
	})
	.extend(baseBlockDataSchema.shape);

export const updateDbAiDescription = {
	name: BlockTypes.db_update,
	description:
		"Updates records in a database table matching specific conditions. A column can be incremented/decremented atomically with { op: 'inc' | 'dec', value }. Output: { count, affected }, the number of rows whose values changed and those rows after the update; a row already holding the values is not counted.",
	jsonSchema: JSON.stringify(z.toJSONSchema(updateDbBlockSchema)),
	output:
		"{ count, affected }: how many rows changed, and those rows after the update. A row already holding the values is not counted.",
	example: {
		connection: "<integration id>",
		tableName: "users",
		conditions: [
			{
				attribute: { kind: "column", value: "id" },
				operator: "eq",
				value: { kind: "literal", value: "js: return getRouteParam('id');" },
				chain: "and",
			},
		],
		data: {
			source: "raw",
			value: { name: "js: return input.name;", login_count: { op: "inc", value: 1 } },
		},
		useParam: false,
	},
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

/** read without parsing — `data.value` was `z.object()`, which strips every key; it is a free-form record now */
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
