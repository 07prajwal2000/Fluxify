import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

const valuesSchema = z.array(z.any());

export const forEachLoopBlockSchema = z
	.object({
		block: z.string().optional().describe("block id for starting the execution"),
		values: valuesSchema.describe("list of items to iterate on"),
		useParam: z.boolean().optional().describe("use parameter as the datasource to iterate on"),
	})
	.extend(baseBlockDataSchema.shape);

export const foreachLoopAiDescription = {
	name: BlockTypes.foreachloop,
	description: "Iterates over an array of items, executing a child block for each item.",
	jsonSchema: JSON.stringify(z.toJSONSchema(forEachLoopBlockSchema)),
	handleInfo: `
Handles:
- 'executor': Connect the block to be executed for each array item.`,
};

export function emitForEachLoop(node: EmitNode) {
	const { values, useParam } = forEachLoopBlockSchema.parse(node.block.data);
	const arr = node.v("arr");
	const i = node.v("i");
	return `const ${arr} = ${useParam ? node.in : JSON.stringify(values)};
for (let ${i} = 0; ${i} < ${arr}.length; ${i}++) {
${node.body("executor", `${arr}[${i}]`)}
}
${node.in} = undefined;
${node.next()}`;
}
