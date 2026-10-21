import z from "zod";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";

export const getHttpRequestBodyBlockSchema = z.any();

export const getHttpRequestBodyAiDescription = {
	name: BlockTypes.httpGetRequestBody,
	description:
		"Returns the body of the incoming request, parsed into the shape the route's content type implies: a JSON value, an object of form fields (multipart files arrive as File objects), a Blob for a raw buffered binary body, a ReadableStream<Uint8Array> when the route pipes an octet-stream body, or a string for plain text. Null when the request carries no body.",
	jsonSchema: JSON.stringify(z.toJSONSchema(getHttpRequestBodyBlockSchema)),
	output:
		"The request body itself, parsed: for a JSON body the object, so the next block reads input.email (not input.body.email). A pipe-stream octet-stream route yields a ReadableStream<Uint8Array> that must be consumed or piped; nothing is buffered. Null when there is no body.",
	example: { blockName: "Read body" },
};

export function emitGetHttpRequestBody(node: EmitNode) {
	return `${node.in} = ctx.requestBody;\n${node.next()}`;
}
