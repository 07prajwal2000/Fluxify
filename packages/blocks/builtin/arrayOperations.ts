import { conditionSchema } from "@fluxify/lib";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";
import { conditionsToJs } from "./if";

export const arrayOperationsEnumSchema = z.enum(["push", "pop", "shift", "unshift", "filter"]);

export const arrayOperationsBlockSchema = z
	.object({
		operation: arrayOperationsEnumSchema.describe("type of operation to perform"),
		value: z.any().optional().describe("the value to insert (if insert operation is made)"),
		useParamAsInput: z
			.boolean()
			.optional()
			.describe("use the parameter as the datasource (passed from previous block's output)"),
		datasource: z.string().describe("global variable to perform the operation on"),
		filterConditions: z
			.array(conditionSchema)
			.optional()
			.describe("list of conditions which are evaluated"),
	})
	.extend(baseBlockDataSchema.shape);

export const arrayOperationsAiDescription = {
	name: BlockTypes.arrayops,
	description: "Performs operations on an array variable (push, pop, shift, unshift).",
	jsonSchema: JSON.stringify(z.toJSONSchema(arrayOperationsBlockSchema)),
};

export function emitArrayOps(node: EmitNode) {
	const input = arrayOperationsBlockSchema.parse(node.block.data);
	const arr = node.v("arr");
	const src = `vars[${JSON.stringify(input.datasource)}]`;
	const value = input.useParamAsInput ? node.in : node.value(input.value);

	let operation: string;
	switch (input.operation) {
		case "push":
		case "unshift":
			operation = `${arr}.${input.operation}(${value});`;
			break;
		case "pop":
		case "shift":
			operation = `${arr}.${input.operation}();`;
			break;
		case "filter": {
			const item = node.v("item");
			const kept = node.v("kept");
			operation = `const ${kept} = [];
for (const ${item} of ${arr}) { if (${conditionsToJs(input.filterConditions || [], node, item)}) ${kept}.push(${item}); }
${arr} = ${src} = ${kept};`;
			break;
		}
	}

	return `let ${arr} = ${src};
if (!Array.isArray(${arr})) throw new Error("datasource is not an array");
${operation}
${node.in} = ${arr};
${node.next()}`;
}
