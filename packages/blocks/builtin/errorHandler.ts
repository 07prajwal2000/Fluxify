import { BlockTypes } from "../blockTypes";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../baseBlock";
import { z } from "zod";

export const errorHandlerBlockSchema = z
  .object({
    next: z
      .string()
      .describe("next block to execute")
      .default("")
      .refine((v) => {
        if (v === "") return true;
        return z.uuidv7().safeParse(v).success;
      }),
  })
  .extend(baseBlockDataSchema.shape);

export const errorHandlerAiDescription = {
  name: BlockTypes.errorHandler,
  description:
    "Catches a failure from any block on the canvas. Exactly one per canvas; connect its source handle to whatever should run when a block fails.",
  jsonSchema: JSON.stringify(z.toJSONSchema(errorHandlerBlockSchema)),
};

export class ErrorHandlerBlock extends BaseBlock {
  private processed: boolean = false;
  constructor(
    next: string,
    context: Context,
    input: z.infer<typeof errorHandlerBlockSchema>,
  ) {
    super(context, input, next);
  }
  override async executeAsync(error?: Error | string): Promise<BlockOutput> {
    if (!this.next || this.processed) {
      return {
        continueIfFail: false,
        successful: false,
        error: error?.toString(),
      };
    }

    this.processed = true;
    return {
      continueIfFail: true,
      successful: false,
      error: error?.toString(),
      next: this.next,
    };
  }
}
