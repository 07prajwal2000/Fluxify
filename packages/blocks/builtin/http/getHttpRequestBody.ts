import { BlockTypes } from "../../blockTypes";
import z from "zod";
import type { EmitNode } from "../../compiler";

export const getHttpRequestBodyBlockSchema = z.any();

export const getHttpRequestBodyAiDescription = {
  name: BlockTypes.httpGetRequestBody,
  description:
    "Returns the body of the incoming request, parsed into the shape the route's content type implies: a JSON value, an object of form fields (multipart files arrive as File objects), a Blob for a raw binary body, or a string for plain text. Null when the request carries no body.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpRequestBodyBlockSchema)),
};

export function emitGetHttpRequestBody(node: EmitNode) {
  return `${node.in} = ctx.requestBody;\n${node.next()}`;
}
