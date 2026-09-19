import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const setHttpHeaderBlockSchema = z
	.object({
		name: z.string().describe("header name (supports js expression)"),
		value: z.string().describe("header value (supports js expression)"),
	})
	.extend(baseBlockDataSchema.shape);

export const setHeaderAiDescription = {
	name: BlockTypes.httpSetHeader,
	description: "Sets a header in the HTTP response.",
	jsonSchema: JSON.stringify(z.toJSONSchema(setHttpHeaderBlockSchema)),
};

export function emitSetHttpHeader(node: EmitNode) {
	const { name, value } = setHttpHeaderBlockSchema.parse(node.block.data);
	return `vars.setHeader(${node.value(name)}, ${node.value(value)});\n${node.next()}`;
}
