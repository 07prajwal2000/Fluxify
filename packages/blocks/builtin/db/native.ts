import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import { IDbAdapter } from "@fluxify/adapters";

export const nativeDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    js: z
      .string()
      .describe(
        "js code to execute (has dbQuery(query: string) global function)",
      ),
  })
  .extend(baseBlockDataSchema.shape);

export const nativeDbAiDescription = {
  name: "db_native",
  description:
    "Executes raw SQL or database-specific commands via JavaScript.",
  jsonSchema: JSON.stringify(z.toJSONSchema(nativeDbBlockSchema)),
};
export class NativeDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof nativeDbBlockSchema>,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(params: any): Promise<BlockOutput> {
    try {
      this.context.vars.dbQuery = this.dbAdapter.raw.bind(this.dbAdapter);
      this.input.js = this.input.js.startsWith("js:")
        ? this.input.js.slice(3)
        : this.input.js;
      const value = await this.context.vm.runAsync(this.input.js, params);
      return {
        continueIfFail: false,
        successful: true,
        next: this.next,
        output: value,
      };
    } catch (e) {
      console.error(e);
      return {
        continueIfFail: false,
        successful: false,
        error: "failed to execute native db block",
      };
    } finally {
      this.context.vars.dbQuery = undefined;
    }
  }
}
