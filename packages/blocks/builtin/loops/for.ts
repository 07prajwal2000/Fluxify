import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
  BlockOptions,
} from "../../baseBlock";
import { Engine } from "../../engine";
import { ExecutionTimeoutError } from "../../errors/timeout";

export const forLoopBlockSchema = z
  .object({
    block: z
      .string()
      .optional()
      .describe("block id for starting the execution"),
    start: z
      .number()
      .or(z.string())
      .describe("iteration start count (can be js expression)"),
    end: z
      .number()
      .or(z.string())
      .describe("iteration end count (can be js expression)"),
    step: z
      .number()
      .or(z.string())
      .optional()
      .default(1)
      .describe("iteration step count (can be js expression)"),
  })
  .extend(baseBlockDataSchema.shape);

export const forLoopAiDescription = {
  name: "for_loop",
  description:
    "Iterates a specific number of times, executing a child block each iteration.",
  jsonSchema: JSON.stringify(z.toJSONSchema(forLoopBlockSchema)),
  handleInfo: `
Handles:
- 'executor': Connect the block to be executed in each loop iteration.`,
};

export class ForLoopBlock extends BaseBlock {
  constructor(
    context: Context,
    input: z.infer<typeof forLoopBlockSchema>,
    protected readonly childEngine: Engine,
    next?: string,
  ) {
    if (!forLoopBlockSchema.safeParse(input).success) {
      throw new Error("Invalid input for ForLoopBlock");
    }
    super(context, input, next);
  }

  override async executeAsync(
    callback?: (i: number) => void,
    options?: BlockOptions,
    useEngine: boolean = true,
  ): Promise<BlockOutput> {
    const { data: input, success } = forLoopBlockSchema.safeParse(this.input);
    if (!success) {
      return {
        continueIfFail: false,
        successful: false,
        next: this.next,
      };
    }
    const step =
      typeof input.step == "string"
        ? ((await this.context.vm.runAsync(
            input.step.startsWith("js:") ? input.step.slice(3) : input.step,
          )) as number)
        : input.step;
    const start =
      typeof input.start == "string"
        ? ((await this.context.vm.runAsync(
            input.start.startsWith("js:") ? input.start.slice(3) : input.start,
          )) as number)
        : input.start;
    const end =
      typeof input.end == "string"
        ? ((await this.context.vm.runAsync(
            input.end.startsWith("js:") ? input.end.slice(3) : input.end,
          )) as number)
        : input.end;
    for (let i = start; i < end; i += step) {
      if (options?.timedOut) {
        throw new ExecutionTimeoutError("Execution timed out");
      }
      if (input.block && useEngine) {
        await this.childEngine.start(input.block, i);
      }
      callback && (await callback(i));
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
    };
  }
}
