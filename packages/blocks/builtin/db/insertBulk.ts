import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { baseBlockDataSchema, Context } from "../../baseBlock";
import { adapterFor, dbFailure } from "./schema";
import { emitJsObject } from "../../compiler";
import type { EmitNode } from "../../compiler";

export const insertBulkDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    data: z.object({
      source: z.enum(["raw", "js"]).describe("source of the value"),
      value: z.array(z.object()).or(z.string()).describe("value to insert"),
    }),
    useParam: z.boolean().describe("use parameter"),
  })
  .extend(baseBlockDataSchema.shape);

export const insertBulkAiDescription = {
  name: BlockTypes.db_insertbulk,
  description:
    "Inserts multiple records into a database table in a batch.",
  jsonSchema: JSON.stringify(z.toJSONSchema(insertBulkDbBlockSchema)),
};

export async function runInsertBulkDb(
  context: Context,
  connection: string,
  tableName: string,
  data: object[],
) {
  try {
    return await adapterFor(context, connection).insertBulk(tableName, data);
  } catch (error) {
    dbFailure("insert bulk", error);
  }
}

/** read without parsing — `data.value` is `z.object()`, which strips every key */
export function emitInsertBulkDb(node: EmitNode) {
  const input = node.block.data as z.infer<typeof insertBulkDbBlockSchema>;
  const data = node.v("data");
  const value = input.data.value;

  let payload: string;
  if (input.useParam) {
    payload = node.in;
  } else if (input.data.source === "js" && typeof value === "string") {
    // matches the block: the stored string is expected to carry the js: prefix
    payload = node.js(value.slice(3), node.in);
  } else {
    payload = emitJsObject(value, node);
  }

  return `const ${data} = ${payload};
if (!Array.isArray(${data})) throw new Error("error in insert bulk: data to insert is not an array");
${node.in} = await lib.dbInsertBulk(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${data});
${node.next()}`;
}
