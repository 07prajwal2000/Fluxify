import { z } from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";

export const errorHandlerBlockSchema = z.object({}).extend(baseBlockDataSchema.shape);

export const errorHandlerAiDescription = {
	name: BlockTypes.errorHandler,
	description:
		"Catches a failure from any block on the canvas. Exactly one per canvas; connect its source handle to whatever should run when a block fails.",
	jsonSchema: JSON.stringify(z.toJSONSchema(errorHandlerBlockSchema)),
	output: "The failed block's error message, as a string.",
	example: { blockName: "On error" },
};
