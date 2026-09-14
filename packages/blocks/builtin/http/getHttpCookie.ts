import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const getHttpCookieBlockSchema = z
  .object({
    name: z.string().describe("name of the cookie (supports js expressions)"),
  })
  .extend(baseBlockDataSchema.shape);

export const getCookieAiDescription = {
  name: BlockTypes.httpGetCookie,
  description:
    "Retrieves a specific cookie from the incoming request.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpCookieBlockSchema)),
};

export function emitGetHttpCookie(node: EmitNode) {
  const { name } = getHttpCookieBlockSchema.parse(node.block.data);
  return `${node.in} = vars.getCookie(${node.value(name)});\n${node.next()}`;
}
