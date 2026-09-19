import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const getHttpHeaderBlockSchema = z
	.object({
		name: z.string().describe("name of the header"),
	})
	.extend(baseBlockDataSchema.shape);

export const getHttpHeaderAiDescription = {
	name: BlockTypes.httpGetHeader,
	description: "Retrieves a specific header from the incoming request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getHttpHeaderBlockSchema)),
};

export function emitGetHttpHeader(node: EmitNode) {
	const { name } = getHttpHeaderBlockSchema.parse(node.block.data);
	return `${node.in} = vars.getHeader(${node.value(name)});\n${node.next()}`;
}
