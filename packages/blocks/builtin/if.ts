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
  description:
    "Branches the flow like an IF/ELSE statement. Directs flow based on whether the condition returns TRUE or FALSE.",
  jsonSchema: JSON.stringify(z.toJSONSchema(ifBlockSchema)),
  // Optimized handle info with strict logical mapping
  handleInfo: `
Handles:
- 'success': Connects if the condition evaluates to TRUE (The IF branch).
- 'failure': Connects if the condition evaluates to FALSE (The ELSE branch).

Constraints:
- This block splits the flow. It does NOT have a 'source' handle.
- You must choose either 'success' or 'failure' for the connection logic.`,
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
    const result = await ConditionEvaluator.evaluateOperatorsList(
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
}
