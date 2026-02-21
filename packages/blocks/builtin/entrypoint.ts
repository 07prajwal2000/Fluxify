import z from "zod";
import { BaseBlock, baseBlockDataSchema, BlockOutput } from "../baseBlock";

export const entrypointBlockSchema = z.object(baseBlockDataSchema.shape);

export const entrypointAiDescription = {
  name: "entrypoint",
  description:
    "The initial block triggered by every incoming API request.",
  jsonSchema: JSON.stringify(z.toJSONSchema(entrypointBlockSchema)),
};

export class EntrypointBlock extends BaseBlock {
  async executeAsync(params?: any): Promise<BlockOutput> {
    return {
      continueIfFail: true,
      successful: true,
      output: params,
      next: this.next,
    };
  }
}
