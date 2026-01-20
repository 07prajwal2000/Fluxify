import {
  conditionSchema,
  evaluateOperator,
  operatorSchema,
} from "@fluxify/lib";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../baseBlock";
import { z } from "zod";
import { ConditionEvaluator, OperatorResult } from "./conditionEvaluator";

export { OperatorResult };

export const ifBlockSchema = z
  .object({
    conditions: z
      .array(conditionSchema)
      .describe("list of conditions which are evaluated"),
  })
  .extend(baseBlockDataSchema.shape);

export const ifConditionAiDescription = {
  name: "if_condition",
  description: `conditional block that evaluates list of conditions and directs the flow based on the result`,
  jsonSchema: JSON.stringify(z.toJSONSchema(ifBlockSchema)),
};

export class IfBlock extends BaseBlock {
  constructor(
    private readonly onSuccess: string,
    private readonly onError: string,
    context: Context,
    input: z.infer<typeof ifBlockSchema>,
  ) {
    super(context, input, onSuccess);
  }
  override async executeAsync(params?: any): Promise<BlockOutput> {
    const { conditions } = this.input as z.infer<typeof ifBlockSchema>;
    const result = ConditionEvaluator.evaluateOperatorsList(
      conditions,
      this.context.vm,
      params,
    );
    return {
      output: params,
      successful: result,
      continueIfFail: true,
      error: undefined,
      next: result ? this.onSuccess : this.onError,
    };
  }
  evaluateResult(results: OperatorResult[]): boolean {
    return ConditionEvaluator.evaluateResult(results);
  }
  evaluateOperator(
    lhs: any,
    rhs: any,
    operator: z.infer<typeof operatorSchema>,
  ): boolean {
    return ConditionEvaluator.evaluateOperator(
      lhs,
      rhs,
      operator,
      this.context.vm,
    );
  }
}
