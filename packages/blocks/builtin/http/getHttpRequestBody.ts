import z from "zod";
import { BaseBlock, BlockOutput } from "../../baseBlock";

export const getHttpRequestBodyBlockSchema = z.any();

export const getHttpRequestBodyAiDescription = {
  name: "get_http_request_body",
  description: `gets http request body and returns it as output`,
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpRequestBodyBlockSchema)),
};

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
