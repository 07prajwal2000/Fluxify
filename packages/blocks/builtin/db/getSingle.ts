import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";
import { whereConditionSchema } from "./schema";
import { ConditionEvaluator } from "../conditionEvaluator";

export const getSingleDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    conditions: z.array(whereConditionSchema).describe("list of conditions"),
  })
  .extend(baseBlockDataSchema.shape);

export const getSingleDbAiDescription = {
  name: "get_single",
  description:
    "Retrieves a single record from a database table.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getSingleDbBlockSchema)),
};

export class GetSingleDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof getSingleDbBlockSchema>,
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
      const result = await this.dbAdapter.getSingle(
        this.input.tableName,
        evaluatedConditions,
      );
      return {
        continueIfFail: false,
        successful: true,
        output: result,
        next: this.next,
      };
    } catch (e) {
      return {
        continueIfFail: false,
        successful: false,
        error: "failed to execute get single db block",
      };
    }
  }
}
