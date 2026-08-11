import { BlockTypes } from "../blockTypes";
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
import type { EmitNode } from "../compiler";

export { OperatorResult };

export const ifBlockSchema = z
  .object({
    conditions: z
      .array(conditionSchema)
      .describe("list of conditions which are evaluated"),
  })
  .extend(baseBlockDataSchema.shape);

export const ifConditionAiDescription = {
  name: BlockTypes.if,
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
const COMPARISONS: Record<string, string> = {
  eq: "==",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

function conditionToJs(
  condition: z.infer<typeof conditionSchema>,
  node: EmitNode,
  input: string,
) {
  const { lhs, rhs, operator, js } = condition;
  const operand = (raw: unknown) =>
    typeof raw === "string" && raw.startsWith("js:")
      ? node.js(raw.slice(3), input, true)
      : JSON.stringify(raw ?? null);

  if (operator === "js") {
    const code = js ?? "";
    return `$truthy(${node.js(code.startsWith("js:") ? code.slice(3) : code, input, true)})`;
  }
  if (operator === "is_empty") return `$isEmpty(${operand(lhs)})`;
  if (operator === "is_not_empty") return `!$isEmpty(${operand(lhs)})`;
  return `(${operand(lhs)} ${COMPARISONS[operator]} ${operand(rhs)})`;
}

/**
 * Conditions are a flat list where `chain: "or"` closes the current group, so
 * the list is a sum of products: (a && b) || (c) || (d && e).
 */
export function conditionsToJs(
  conditions: z.infer<typeof conditionSchema>[],
  node: EmitNode,
  input: string,
) {
  const groups: string[][] = [[]];
  for (const condition of conditions) {
    groups[groups.length - 1].push(conditionToJs(condition, node, input));
    if (condition.chain === "or") groups.push([]);
  }
  const expr = groups
    .filter((g) => g.length)
    .map((g) => `(${g.join(" && ")})`)
    .join(" || ");
  return expr || "true";
}

export function emitIf(node: EmitNode) {
  const { conditions } = ifBlockSchema.parse(node.block.data);
  return `if (${conditionsToJs(conditions, node, node.in)}) {
${node.next("success")}
} else {
${node.next("failure")}
}`;
}

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
