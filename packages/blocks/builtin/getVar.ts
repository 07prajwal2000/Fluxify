import { BlockTypes } from "../blockTypes";
import z from "zod";
import { BaseBlock, baseBlockDataSchema, BlockOutput } from "../baseBlock";
import type { EmitNode } from "../compiler";

export const getVarBlockSchema = z
  .object({
    key: z.string(),
  })
  .extend(baseBlockDataSchema.shape);

export const getVarAiDescription = {
  name: BlockTypes.getvar,
  description:
    "Retrieves a value from the global execution context.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getVarBlockSchema)),
};

export function emitGetVar(node: EmitNode) {
  const { key } = getVarBlockSchema.parse(node.block.data);
  return `${node.in} = vars[${JSON.stringify(key)}];\n${node.next()}`;
}

export class GetVarBlock extends BaseBlock {
  override async executeAsync(params?: any): Promise<BlockOutput> {
    const { data, success } = getVarBlockSchema.safeParse(this.input);
    if (!success) {
      return {
        continueIfFail: true,
        successful: false,
        next: this.next,
        output: null,
      };
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: this.context.vars[data.key],
    };
  }
}
