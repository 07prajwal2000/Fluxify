import z from "zod";
import { BaseBlock, baseBlockDataSchema, BlockOutput } from "../baseBlock";

export const entrypointBlockSchema = z.object(baseBlockDataSchema.shape);

export const entrypointAiDescription = {
  name: "entrypoint",
  description: `the main entry point block of the request`,
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
