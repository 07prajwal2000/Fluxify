import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
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
};

export function emitJsRunner(node: EmitNode) {
	const { value } = jsRunnerBlockSchema.parse(node.block.data);
	return `${node.in} = ${node.js(value, node.in)};\n${node.next()}`;
}
