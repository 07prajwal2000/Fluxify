import { BlockTypes } from "../blockTypes";
import { baseBlockDataSchema } from "../baseBlock";
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
