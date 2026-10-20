import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const transformerBlockSchema = z
	.object({
		fieldMap: z
			.record(z.string(), z.string())
			.describe("key value pairs which map the source key to destination object's key"),
		js: z
			.string()
			.optional()
			.describe(
				"js code executed when useJs is enabled. A global variable 'input' which stores the source object",
			),
		useJs: z.boolean().default(false).describe("enable to run the js code"),
	})
	.extend(baseBlockDataSchema.shape);

export const transformBlockAiDescription = {
	name: BlockTypes.transformer,
	description: "Transforms input data into a new structure using JavaScript.",
	jsonSchema: JSON.stringify(z.toJSONSchema(transformerBlockSchema)),
	output:
		"With useJs: whatever js returns. Otherwise a new object holding each fieldMap key's input value under its mapped name: fieldMap { id: 'userId' } turns { id: 1 } into { userId: 1 }.",
	example: { fieldMap: { id: "userId", email: "email" }, useJs: false },
};

/**
 * A field map applied to `input` (an expression): each source key's value
 * under its destination key. A plugin `fieldMap` param is emitted with this
 * too, so it maps exactly like a Transformer.
 */
export function emitFieldMap(fieldMap: Record<string, unknown>, input: string) {
	const fields = Object.entries(fieldMap).map(
		([from, to]) => `${JSON.stringify(to)}: ${input}[${JSON.stringify(from)}]`,
	);
	return `{ ${fields.join(", ")} }`;
}

export function emitTransformer(node: EmitNode) {
	const { fieldMap, js, useJs } = transformerBlockSchema.parse(node.block.data);
	if (useJs) {
		return `${node.in} = ${node.js(js || "", node.in)};\n${node.next()}`;
	}
	return `${node.in} = ${emitFieldMap(fieldMap, node.in)};\n${node.next()}`;
}
