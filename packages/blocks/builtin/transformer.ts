import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../baseBlock";
import { baseBlockDataSchema } from "../baseBlock";

export const transformerBlockSchema = z
  .object({
    fieldMap: z
      .record(z.string(), z.string())
      .describe(
        "key value pairs which map the source key to destination object's key",
      ),
    js: z
      .string()
      .optional()
      .describe(
        "js code executed when useJs is enabled. A global variable 'input' which stores the source object",
      ),
    useJs: z.boolean().default(false).describe("enable to run the js code"),
  })
  .extend(baseBlockDataSchema.shape);

export const transformerParamsSchema = z.record(z.string(), z.any().optional());

export const transformBlockAiDescription = {
  name: "transformer",
  description:
    "Transforms input data into a new structure using JavaScript.",
  jsonSchema: JSON.stringify(z.toJSONSchema(transformerBlockSchema)),
};

export class TransformerBlock extends BaseBlock {
  constructor(
    context: Context,
    input: z.infer<typeof transformerBlockSchema>,
    next?: string,
  ) {
    super(context, input, next);
  }

  override async executeAsync(
    params: Record<string, any>,
  ): Promise<BlockOutput> {
    const { data: input, success } = transformerBlockSchema.safeParse(
      this.input,
    );
    if (!success) {
      return {
        continueIfFail: false,
        successful: false,
        next: this.next,
        error: "Invalid input for the transformer block",
      };
    }
    if (!transformerParamsSchema.safeParse(params).success) {
      return {
        continueIfFail: false,
        successful: false,
        next: this.next,
        error: "Invalid params for the transformer block",
      };
    }
    if (input.useJs) {
      return {
        continueIfFail: true,
        successful: true,
        next: this.next,
        output: await this.context.vm.runAsync(input.js || "", params),
      };
    }
    const result: Record<string, any> = {};
    for (let key in input.fieldMap) {
      if (!params.hasOwnProperty(key)) {
        return {
          continueIfFail: false,
          successful: false,
          next: this.next,
          error: `Missing Key: ${key} in the params for the transformer block`,
        };
      }
      result[input.fieldMap[key]] = params[key];
    }
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: result,
    };
  }
}
