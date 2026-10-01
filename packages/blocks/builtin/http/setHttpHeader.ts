import z from "zod";
import { rowsOf, singleOrMultiple } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const setHttpHeaderBlockSchema = singleOrMultiple(
	z.object({
		name: z.string().describe("header name (supports js expression)"),
		value: z.string().describe("header value (supports js expression)"),
	}),
);

export const setHeaderAiDescription = {
	name: BlockTypes.httpSetHeader,
	description: "Sets a header in the HTTP response.",
	jsonSchema: JSON.stringify(z.toJSONSchema(setHttpHeaderBlockSchema)),
};

export function emitSetHttpHeader(node: EmitNode) {
	const data = setHttpHeaderBlockSchema.parse(node.block.data);
	// passes its input through; a later row with the same name replaces the earlier one
	const set = rowsOf(data).map(
		({ name, value }) => `vars.setHeader(${node.value(name)}, ${node.value(value)});\n`,
	);
	return `${set.join("")}${node.next()}`;
}
