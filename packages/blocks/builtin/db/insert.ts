import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { baseBlockDataSchema, Context } from "../../baseBlock";
import { adapterFor, dbFailure } from "./schema";
import { emitJsObject } from "../../compiler";
import type { EmitNode } from "../../compiler";

export const insertDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    data: z.object({
      source: z.enum(["raw", "js"]).describe("source of the value"),
      value: z
        .object()
        .describe("value to insert (object values can be js expression)"),
    }),
    useParam: z.boolean().default(false).describe("use parameter"),
  })
  .extend(baseBlockDataSchema.shape);

export const insertDbAiDescription = {
  name: BlockTypes.db_insert,
  description:
    "Inserts a single record into a database table.",
  jsonSchema: JSON.stringify(z.toJSONSchema(insertDbBlockSchema)),
};

export async function runInsertDb(
  context: Context,
  connection: string,
  tableName: string,
  data: object,
) {
  try {
    return await adapterFor(context, connection).insert(tableName, data);
  } catch (error) {
    dbFailure("insert", error);
  }
}

/**
 * A literal payload is walked at compile time, so its `js:` values become
 * inlined code. A payload that only exists at runtime is data: it is forwarded
 * unchanged and can never introduce a new executable `js:` expression.
 *
 * Read without parsing: the schema types `data.value` as an object, but the
 * block also accepts a string there when `source` is "js".
 */
export function emitInsertDb(node: EmitNode) {
  const input = node.block.data as z.infer<typeof insertDbBlockSchema>;
  const data = node.v("data");
  const value = input.data.value as unknown;

  let payload: string;
  if (input.useParam) {
    payload = node.in;
  } else if (input.data.source === "js" && typeof value === "string") {
    payload = node.js(value, node.in);
  } else {
    payload = emitJsObject(value, node);
  }

  return `const ${data} = ${payload};
if (typeof ${data} !== "object") throw new Error("error in insert: data to insert is not an object");
${node.in} = await lib.dbInsert(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${data});
${node.next()}`;
}
