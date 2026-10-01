import z from "zod";
import { rowsOutput, singleOrMultiple } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const getHttpCookieBlockSchema = singleOrMultiple(
	z.object({
		name: z.string().describe("name of the cookie (supports js expressions)"),
	}),
);

export const getCookieAiDescription = {
	name: BlockTypes.httpGetCookie,
	description: "Retrieves a specific cookie from the incoming request.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getHttpCookieBlockSchema)),
};

export function emitGetHttpCookie(node: EmitNode) {
	const data = getHttpCookieBlockSchema.parse(node.block.data);
	const out = rowsOutput(data, ({ name }) => `vars.getCookie(${node.value(name)})`);
	return `${node.in} = ${out};\n${node.next()}`;
}
