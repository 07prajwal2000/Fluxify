import z from "zod";
import { BaseBlock, BlockOutput } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const getHttpRequestBodyBlockSchema = z.any();

export const getHttpRequestBodyAiDescription = {
  name: "get_http_request_body",
  description:
    "Returns the body of the incoming request, parsed into the shape the route's content type implies: a JSON value, an object of form fields (multipart files arrive as File objects), a Blob for a raw binary body, or a string for plain text. Null when the request carries no body.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpRequestBodyBlockSchema)),
};

export function emitGetHttpRequestBody(node: EmitNode) {
  return `${node.in} = ctx.requestBody;\n${node.next()}`;
}

export class GetHttpRequestBodyBlock extends BaseBlock {
  override async executeAsync(): Promise<BlockOutput> {
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: this.context.requestBody,
    };
  }
}
