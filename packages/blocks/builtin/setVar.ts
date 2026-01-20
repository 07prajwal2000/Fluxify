import z from "zod";
import {
  BaseBlock,
  baseBlockDataSchema,
  BlockOutput,
  Context,
} from "../baseBlock";

export const setVarSchema = z
  .object({
    key: z.string().describe("The name of the variable"),
    value: z
      .any()
      .describe(
        "The value of the variable (can be number,bool,string,object or js expression)",
      ),
  })
  .extend(baseBlockDataSchema.shape)
  .describe("A useful block to set a variable in the context");

export const setVarBlockAiDescription = {
  name: "set_var",
  description: `sets a global variable in the execution context`,
  jsonSchema: JSON.stringify(z.toJSONSchema(setVarSchema)),
};

export class SetVarBlock extends BaseBlock {
  constructor(
    context: Context,
    input: z.infer<typeof setVarSchema>,
    next?: string,
    private readonly useParam?: boolean,
  ) {
    super(context, input, next);
  }
  public override async executeAsync(params?: any): Promise<BlockOutput> {
    const input = this.input as z.infer<typeof setVarSchema>;
    const value = await this.evaluateValue(
      this.useParam ? params : input.value,
      params,
    );
    this.context.vars[this.input.key] = value;
    return {
      continueIfFail: true,
      successful: true,
      next: this.next,
      output: value,
    };
  }

  private evaluateValue(value: any, params?: any): Promise<any> {
    if (typeof value == "string" && value.startsWith("js:")) {
      return this.context.vm.runAsync(value.slice(3), params);
    }
    return Promise.resolve(value);
  }
}
