import z from "zod";
import { BaseBlock, BlockOutput } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const getHttpRequestBodyBlockSchema = z.any();

export const getHttpRequestBodyAiDescription = {
  name: "get_http_request_body",
  description:
    "Retrieves and returns the raw body of the incoming request.",
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
