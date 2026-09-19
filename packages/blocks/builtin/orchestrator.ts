import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const orchestratorBlockSchema = z
	.object({
		order: z
			.array(z.string())
			.optional()
			.default([])
			.describe(
				"target block ids of the 'orchestrate' connections, in the order their outputs appear in the result array; unlisted connections come after",
			),
		onError: z
			.enum(["throw", "settle"])
			.optional()
			.default("throw")
			.describe(
				"'throw': a failing branch fails the block (error handler runs). 'settle': every branch finishes and a failed branch's slot holds its error message",
			),
	})
	.extend(baseBlockDataSchema.shape);

export const orchestratorAiDescription = {
	name: BlockTypes.orchestrator,
	description:
		"Runs every chain connected to its 'orchestrate' handle at the same time, each with this block's input, then continues with an array of each chain's final output (ordered by data.order).",
	jsonSchema: JSON.stringify(z.toJSONSchema(orchestratorBlockSchema)),
	handleInfo: `
Handles:
- 'orchestrate': Connect the first block of each parallel chain. Any number of connections.
- 'source': Continues after all chains finish, with the array of their outputs as input.

Constraints:
- A response block inside a chain ends the whole route as soon as it is reached; the other chains are ignored.`,
};

export function emitOrchestrator(node: EmitNode) {
	const { order, onError } = orchestratorBlockSchema.parse(node.block.data);
	const result = node.v("branches");
	return `const ${result} = ${node.parallel("orchestrate", order, onError === "settle")};
// a branch reached a terminal block: that result ends the route
if (!Array.isArray(${result})) return ${result};
${node.in} = ${result};
${node.next()}`;
}
