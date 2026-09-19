import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const forLoopBlockSchema = z
	.object({
		block: z.string().optional().describe("block id for starting the execution"),
		start: z.number().or(z.string()).describe("iteration start count (can be js expression)"),
		end: z.number().or(z.string()).describe("iteration end count (can be js expression)"),
		step: z
			.number()
			.or(z.string())
			.optional()
			.default(1)
			.describe("iteration step count (can be js expression)"),
	})
	.extend(baseBlockDataSchema.shape);

export const forLoopAiDescription = {
	name: BlockTypes.forloop,
	description: "Iterates a specific number of times, executing a child block each iteration.",
	jsonSchema: JSON.stringify(z.toJSONSchema(forLoopBlockSchema)),
	handleInfo: `
Handles:
- 'executor': Connect the block to be executed in each loop iteration.`,
};

/** bounds may be js expressions — those are evaluated once, before the loop */
export function boundToJs(bound: number | string, node: EmitNode) {
	if (typeof bound === "number") return String(bound);
	return node.js(bound.startsWith("js:") ? bound.slice(3) : bound);
}

export function emitForLoop(node: EmitNode) {
	const { start, end, step } = forLoopBlockSchema.parse(node.block.data);
	const i = node.v("i");
	const to = node.v("end");
	const by = node.v("step");
	return `const ${to} = ${boundToJs(end, node)}, ${by} = ${boundToJs(step, node)};
for (let ${i} = ${boundToJs(start, node)}; ${i} < ${to}; ${i} += ${by}) {
${node.body("executor", i)}
}
${node.in} = undefined;
${node.next()}`;
}
