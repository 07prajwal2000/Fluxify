import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import { IDbAdapter } from "@fluxify/adapters";

export const insertDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    data: z.object({
      source: z.enum(["raw", "js"]).describe("source of the value"),
      value: z
        .object()
        .describe("value to insert (object values can be js expression)"),
    }),
    useParam: z.boolean().default(false).describe("use parameter"),
  })
  .extend(baseBlockDataSchema.shape);

export const insertDbAiDescription = {
  name: "db_insert",
  description: `inserts single record into a database table`,
  jsonSchema: JSON.stringify(z.toJSONSchema(insertDbBlockSchema)),
};

export class InsertDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof insertDbBlockSchema>,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(data: object): Promise<BlockOutput> {
    try {
      let dataToInsert = this.input.useParam ? data : this.input.data.value;
      if (
        !this.input.useParam &&
        this.input.data.source === "js" &&
        typeof this.input.data.value === "string"
      ) {
        dataToInsert = (await this.context.vm.runAsync(
          this.input.data.value,
        )) as object;
      }
      if (typeof dataToInsert !== "object") {
        return {
          continueIfFail: false,
          successful: false,
          error: "error in insert: data to insert is not an object",
        };
      }
      dataToInsert = await this.evaluateJsInData(dataToInsert);
      this.input.tableName = this.input.tableName.startsWith("js:")
        ? ((await this.context.vm.runAsync(
            this.input.tableName.slice(3),
          )) as string)
        : this.input.tableName;

      const result = await this.dbAdapter.insert(
        this.input.tableName,
        dataToInsert,
      );
      return {
        continueIfFail: false,
        successful: true,
        output: result,
        next: this.next,
      };
    } catch (e) {
      console.error(e);
      return {
        continueIfFail: false,
        successful: false,
        error: "failed to execute insert db block",
      };
    }
  }
  private async evaluateJsInData(data: any): Promise<any> {
    const result: any = {};
    for (const key in data) {
      const value = data[key];
      if (typeof value === "string" && value.startsWith("js:")) {
        result[key] = await this.context.vm.runAsync(value.slice(3));
      } else if (typeof value === "object") {
        result[key] = await this.evaluateJsInData(value);
      } else if (Array.isArray(value)) {
        result[key] = await this.evaluateJsInArray(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  private async evaluateJsInArray(data: any[]): Promise<any[]> {
    const result: any[] = [];
    for (const item of data) {
      if (typeof item === "string" && item.startsWith("js:")) {
        result.push(await this.context.vm.runAsync(item.slice(3)));
      } else if (typeof item === "object") {
        result.push(await this.evaluateJsInData(item));
      } else if (Array.isArray(item)) {
        result.push(await this.evaluateJsInArray(item));
      } else {
        result.push(item);
      }
    }
    return result;
  }
}
