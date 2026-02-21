import z from "zod";
import {
  baseBlockDataSchema,
  BlockOptions,
  BlockOutput,
  Context,
} from "../../baseBlock";
import { Engine } from "../../engine";
import { ForLoopBlock, forLoopBlockSchema } from "./for";
import { ExecutionTimeoutError } from "../../errors/timeout";

const valuesSchema = z.array(z.any());

export const forEachLoopBlockSchema = z
  .object({
    block: z
      .string()
      .optional()
      .describe("block id for starting the execution"),
    values: valuesSchema.describe("list of items to iterate on"),
    useParam: z
      .boolean()
      .optional()
      .describe("use parameter as the datasource to iterate on"),
  })
  .extend(baseBlockDataSchema.shape);

export const foreachLoopAiDescription = {
  name: "foreach_loop",
  description:
    "Iterates over an array of items, executing a child block for each item.",
  jsonSchema: JSON.stringify(z.toJSONSchema(forEachLoopBlockSchema)),
  handleInfo: `
Handles:
- 'executor': Connect the block to be executed for each array item.`,
};

export class ForEachLoopBlock extends ForLoopBlock {
  private readonly values: any[] | string = null!;
  private readonly foreachInput: z.infer<typeof forEachLoopBlockSchema> = null!;
  constructor(
    context: Context,
    input: z.infer<typeof forEachLoopBlockSchema>,
    subEngine: Engine,
    next?: string,
  ) {
    const { success, data: foreachInput } =
      forEachLoopBlockSchema.safeParse(input);
    if (!success) {
      throw new Error("Invalid input for ForEachLoopBlock");
    }
    super(
      context,
      {
        start: 0,
        end: input.values.length,
        step: 1,
        block: input.block,
        blockName: input.blockName,
        blockDescription: "",
      },
      subEngine,
      next,
    );
    this.foreachInput = foreachInput;
    this.values = input.values;
  }

  override async executeAsync(
    params?: any,
    options?: BlockOptions,
  ): Promise<BlockOutput> {
    const paramValues = valuesSchema.safeParse(params);
    if (this.foreachInput.useParam && (!params || !paramValues.success)) {
      return {
        continueIfFail: false,
        successful: false,
        next: this.next,
        error: "Invalid params passed for ForEachLoop Block from parent block",
      };
    }
    const input = this.input as z.infer<typeof forLoopBlockSchema>;
    if (!input.block) {
      return {
        continueIfFail: true,
        successful: true,
        next: this.next,
      };
    }
    if (this.foreachInput.useParam && paramValues.success) {
      input.end = params.length;
    }
    const array = this.foreachInput.useParam ? paramValues.data! : this.values;
    await super.executeAsync(
      async (i) => {
        if (options?.timedOut) {
          throw new ExecutionTimeoutError("Execution timed out");
        }
        await this.childEngine.start(input.block!, array[i]);
      },
      options,
      false,
    );
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
    };
  }
}
