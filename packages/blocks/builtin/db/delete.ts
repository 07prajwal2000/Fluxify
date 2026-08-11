import { BlockTypes } from "../../blockTypes";
import z from "zod";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";
import {
  adapterFor,
  dbFailure,
  dbWhereConditionsDescription,
  whereConditionSchema,
} from "./schema";
import { emitWhereConditions } from "./emitConditions";
import { ConditionEvaluator } from "../conditionEvaluator";
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
  return `${node.in} = await lib.dbDelete(ctx, ${JSON.stringify(input.connection)}, ${node.value(input.tableName)}, ${emitWhereConditions(input.conditions, node)});
${node.next()}`;
}

export class DeleteDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof deleteDbBlockSchema>,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(): Promise<BlockOutput> {
    try {
      this.input.tableName = this.input.tableName.startsWith("js:")
        ? ((await this.context.vm.runAsync(
            this.input.tableName.slice(3),
          )) as string)
        : this.input.tableName;
      const evaluatedConditions = await Promise.all(
        this.input.conditions.map(async (condition) => {
          const { lhs, rhs } = await ConditionEvaluator.evaluateScript(
            condition.attribute,
            condition.value,
            this.context.vm,
          );
          return {
            ...condition,
            attribute: lhs,
            value: rhs,
          };
        }),
      );
      const result = await this.dbAdapter.delete(
        this.input.tableName,
        evaluatedConditions,
      );
      return {
        continueIfFail: false,
        successful: true,
        output: result,
        next: this.next,
      };
    } catch {
      return {
        continueIfFail: false,
        successful: false,
        error: "failed to execute delete db block",
      };
    }
  }
}
