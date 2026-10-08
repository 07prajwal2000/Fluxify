import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const entrypointBlockSchema = z.object(baseBlockDataSchema.shape);

export const entrypointAiDescription = {
	name: BlockTypes.entrypoint,
	description: "The initial block triggered by every incoming API request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(entrypointBlockSchema)),
	output:
		"What the run started with, unchanged: on a route the parsed request body (same as httpgetrequestbody), on a workflow the data it was started with, in a custom block the caller's input.",
	example: { blockName: "Start" },
};

/** request body already sits in the flowing variable, so this is pure routing */
export function emitEntrypoint(node: EmitNode) {
	return node.next();
}
