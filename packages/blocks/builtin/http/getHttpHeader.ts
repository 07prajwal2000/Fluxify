import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { BaseBlock, BlockOutput } from "../../baseBlock";
import { baseBlockDataSchema } from "../../baseBlock";
import type { EmitNode } from "../../compiler";

export const getHttpHeaderBlockSchema = z
  .object({
    name: z.string().describe("name of the header"),
  })
  .extend(baseBlockDataSchema.shape);

export const getHttpHeaderAiDescription = {
  name: BlockTypes.httpGetHeader,
  description:
    "Retrieves a specific header from the incoming request.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpHeaderBlockSchema)),
};

export function emitGetHttpHeader(node: EmitNode) {
  const { name } = getHttpHeaderBlockSchema.parse(node.block.data);
  return `${node.in} = vars.getHeader(${node.value(name)});\n${node.next()}`;
}

export class GetHttpHeaderBlock extends BaseBlock {
  override async executeAsync(): Promise<BlockOutput> {
    const input = this.input as z.infer<typeof getHttpHeaderBlockSchema>;
    const name = input.name.startsWith("js:")
      ? await this.context.vm.runAsync(input.name.substring(3))
      : input.name;

    const header = this.context.vars.getHeader(name);
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: header,
    };
  }
}
