import z from "zod";
import { rowsOutput, singleOrMultiple } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const setVarSchema = singleOrMultiple(
	z.object({
		key: z.string().describe("The name of the variable"),
		value: z
			.any()
			.describe("The value of the variable (can be number,bool,string,object or js expression)"),
	}),
)
	.superRefine((data, ctx) => {
		if (data.mode !== "multiple") return;
		const seen = new Set<string>();
		data.items.forEach(({ key }, i) => {
			if (seen.has(key)) {
				ctx.addIssue({
					code: "custom",
					path: ["items", i, "key"],
					message: `Variable "${key}" is set twice`,
				});
			}
			seen.add(key);
		});
	})
	.describe("A useful block to set a variable in the context");

export const setVarBlockAiDescription = {
	name: BlockTypes.setvar,
	description: "Assigns a value to a variable in the global execution context.",
	jsonSchema: JSON.stringify(z.toJSONSchema(setVarSchema)),
	output: "The value it stored. Multiple mode: an array of the stored values, in row order.",
	example: { key: "userId", value: "js: return input.id;" },
};

export function emitSetVar(node: EmitNode) {
	const data = setVarSchema.parse(node.block.data);
	// rows assign in order, so a later row's js: can read an earlier row's variable
	const out = rowsOutput(
		data,
		({ key, value }) => `vars[${JSON.stringify(key)}] = ${node.value(value)}`,
	);
	return `${node.in} = ${out};\n${node.next()}`;
}
