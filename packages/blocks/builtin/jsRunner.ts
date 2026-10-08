import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const jsRunnerBlockSchema = z
	.object({
		value: z.string(),
	})
	.extend(baseBlockDataSchema.shape);

export const jsRunnerAiDescription = {
	name: BlockTypes.jsrunner,
	description: "Executes JavaScript code within an isolated function scope.",
	jsonSchema: JSON.stringify(z.toJSONSchema(jsRunnerBlockSchema)),
	output: "Whatever the code returns; undefined when it returns nothing.",
	example: {
		value:
			"const total = input.items.reduce((sum, item) => sum + item.price, 0);\nreturn { ...input, total };",
	},
};

export function emitJsRunner(node: EmitNode) {
	const { value } = jsRunnerBlockSchema.parse(node.block.data);
	return `${node.in} = ${node.js(value, node.in)};\n${node.next()}`;
}
