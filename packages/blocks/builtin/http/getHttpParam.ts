import z from "zod";
import { BaseBlock, BlockOutput } from "../../baseBlock";
import { baseBlockDataSchema } from "../../baseBlock";

export const getHttpParamBlockSchema = z
  .object({
    name: z.string().describe("parameter name (supports js expressions)"),
    source: z.enum(["query", "path"]).describe("source of the parameter"),
  })
  .extend(baseBlockDataSchema.shape);

export const getHttpParamAiDescription = {
  name: "get_http_param",
  description:
    "Retrieves a query parameter or route parameter from the request.",
  jsonSchema: JSON.stringify(z.toJSONSchema(getHttpParamBlockSchema)),
};

export class GetHttpParamBlock extends BaseBlock {
  override async executeAsync(): Promise<BlockOutput> {
    const input = this.input as z.infer<typeof getHttpParamBlockSchema>;
    input.name = input.name.startsWith("js:")
      ? ((await this.context.vm.runAsync(input.name.slice(3))) as string)
      : input.name;
    let value = this.context.vars.getQueryParam(input.name);
    if (input.source === "path") {
      value = this.context.vars.getRouteParam(input.name);
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: value,
    };
  }
}
