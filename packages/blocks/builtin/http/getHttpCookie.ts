import z from "zod";
import { BaseBlock, BlockOutput } from "../../baseBlock";
import { baseBlockDataSchema } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const getHttpCookieBlockSchema = z
  .object({
    name: z.string().describe("name of the cookie (supports js expressions)"),
  })
  .extend(baseBlockDataSchema.shape);

export const getCookieAiDescription = {
  name: "get_request_cookie",
  description:
    "Retrieves a specific cookie from the incoming request.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpCookieBlockSchema)),
};

export function emitGetHttpCookie(node: EmitNode) {
  const { name } = getHttpCookieBlockSchema.parse(node.block.data);
  return `${node.in} = vars.getCookie(${node.value(name)});\n${node.next()}`;
}

export class GetHttpCookieBlock extends BaseBlock {
  override async executeAsync(): Promise<BlockOutput> {
    const input = this.input as z.infer<typeof getHttpCookieBlockSchema>;
    input.name = input.name.startsWith("js:")
      ? ((await this.context.vm.runAsync(input.name.substring(3))) as string)
      : input.name;
    const cookie = this.context.vars.getCookie(input.name);
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: cookie,
    };
  }
}
