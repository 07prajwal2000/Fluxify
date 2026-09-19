import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const getHttpParamBlockSchema = z
	.object({
		name: z.string().describe("parameter name (supports js expressions)"),
		source: z.enum(["query", "path"]).describe("source of the parameter"),
	})
	.extend(baseBlockDataSchema.shape);

export const getHttpParamAiDescription = {
	name: BlockTypes.httpGetParam,
	description: "Retrieves a query parameter or route parameter from the request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getHttpParamBlockSchema)),
};

export function emitGetHttpParam(node: EmitNode) {
	const { name, source } = getHttpParamBlockSchema.parse(node.block.data);
	const getter = source === "path" ? "getRouteParam" : "getQueryParam";
	return `${node.in} = vars.${getter}(${node.value(name)});\n${node.next()}`;
}
