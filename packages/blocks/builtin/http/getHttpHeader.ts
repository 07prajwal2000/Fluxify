import z from "zod";
import { rowsOutput, singleOrMultiple } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const getHttpHeaderBlockSchema = singleOrMultiple(
	z.object({
		name: z.string().describe("name of the header"),
	}),
);

export const getHttpHeaderAiDescription = {
	name: BlockTypes.httpGetHeader,
	description: "Retrieves a specific header from the incoming request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getHttpHeaderBlockSchema)),
};

export function emitGetHttpHeader(node: EmitNode) {
	const data = getHttpHeaderBlockSchema.parse(node.block.data);
	const out = rowsOutput(data, ({ name }) => `vars.getHeader(${node.value(name)})`);
	return `${node.in} = ${out};\n${node.next()}`;
}
