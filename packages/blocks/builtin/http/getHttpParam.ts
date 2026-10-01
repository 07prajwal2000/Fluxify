import z from "zod";
import { rowsOutput, singleOrMultiple } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const getHttpParamBlockSchema = singleOrMultiple(
	z.object({
		name: z.string().describe("parameter name (supports js expressions)"),
		source: z.enum(["query", "path"]).describe("source of the parameter"),
	}),
);

export const getHttpParamAiDescription = {
	name: BlockTypes.httpGetParam,
	description: "Retrieves a query parameter or route parameter from the request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getHttpParamBlockSchema)),
};

export function emitGetHttpParam(node: EmitNode) {
	const data = getHttpParamBlockSchema.parse(node.block.data);
	const out = rowsOutput(data, ({ name, source }) => {
		const getter = source === "path" ? "getRouteParam" : "getQueryParam";
		return `vars.${getter}(${node.value(name)})`;
	});
	return `${node.in} = ${out};\n${node.next()}`;
}
