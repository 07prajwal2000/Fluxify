import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import type { EmitNode } from "../compiler";

export const entrypointBlockSchema = z.object(baseBlockDataSchema.shape);

export const entrypointAiDescription = {
	name: BlockTypes.entrypoint,
	description: "The initial block triggered by every incoming API request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(entrypointBlockSchema)),
};

/** request body already sits in the flowing variable, so this is pure routing */
export function emitEntrypoint(node: EmitNode) {
	return node.next();
}
