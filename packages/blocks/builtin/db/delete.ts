import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { baseBlockDataSchema, Context } from "../../baseBlock";
import {
  adapterFor,
  dbFailure,
  dbWhereConditionsDescription,
  whereConditionSchema,
} from "./schema";
import { emitWhereConditions } from "./emitConditions";
import type { EmitNode } from "../../compiler";

export const deleteDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    conditions: z.array(whereConditionSchema).describe(dbWhereConditionsDescription),
  })
  .extend(baseBlockDataSchema.shape);

export const deleteDbAiDescription = {
  name: BlockTypes.db_delete,
  description:
    "Deletes records from a database table matching specific conditions.",
  jsonSchema: JSON.stringify(z.toJSONSchema(deleteDbBlockSchema)),
};

export async function runDeleteDb(
  context: Context,
  connection: string,
  tableName: string,
  conditions: z.infer<typeof whereConditionSchema>[],
) {
  try {
    return await adapterFor(context, connection).delete(tableName, conditions);
  } catch (error) {
    dbFailure("delete", error);
  }
}

export function emitDeleteDb(node: EmitNode) {
  const input = deleteDbBlockSchema.parse(node.block.data);
  return `${node.in} = await lib.dbDelete(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)});
${node.next()}`;
}
