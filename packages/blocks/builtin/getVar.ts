import z from "zod";
import { rowsOutput, singleOrMultiple } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const getVarBlockSchema = singleOrMultiple(
	z.object({
		key: z.string(),
	}),
);

export const getVarAiDescription = {
	name: BlockTypes.getvar,
	description: "Retrieves a value from the global execution context.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getVarBlockSchema)),
	output: "The variable's value. Multiple mode: an array of the values, in row order.",
	example: { key: "userId" },
};

export function emitGetVar(node: EmitNode) {
	const data = getVarBlockSchema.parse(node.block.data);
	const out = rowsOutput(data, ({ key }) => `vars[${JSON.stringify(key)}]`);
	return `${node.in} = ${out};\n${node.next()}`;
}
