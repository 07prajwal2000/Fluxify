import z from "zod";
import { BaseBlock, baseBlockDataSchema, BlockOutput } from "../baseBlock";

export const jsRunnerBlockSchema = z
  .object({
    value: z.string(),
  })
  .extend(baseBlockDataSchema.shape);

export const jsRunnerAiDescription = {
  name: "js_runner",
  description: `runs javascript inside Immediately Invoked Function Expression`,
  jsonSchema: JSON.stringify(z.toJSONSchema(jsRunnerBlockSchema)),
};

export class JsRunnerBlock extends BaseBlock {
  override async executeAsync(params?: any): Promise<BlockOutput> {
    try {
      const result = await this.context.vm.runAsync(this.input.value, params);
      return {
        continueIfFail: true,
        successful: true,
        output: result,
        next: this.next,
      };
    } catch (error) {
      return {
        continueIfFail: false,
        successful: false,
        error: error?.toString(),
        next: this.next,
      };
    }
  }
}
