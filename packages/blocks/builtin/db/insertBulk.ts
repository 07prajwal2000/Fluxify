import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";

export const insertBulkDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    data: z.object({
      source: z.enum(["raw", "js"]).describe("source of the value"),
      value: z.array(z.object()).or(z.string()).describe("value to insert"),
    }),
    useParam: z.boolean().describe("use parameter"),
  })
  .extend(baseBlockDataSchema.shape);

export const insertBulkAiDescription = {
  name: "db_insert_bulk",
  description:
    "Inserts multiple records into a database table in a batch.",
  jsonSchema: JSON.stringify(z.toJSONSchema(insertBulkDbBlockSchema)),
};

export class InsertBulkDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof insertBulkDbBlockSchema>,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(data: object[]): Promise<BlockOutput> {
    try {
      let dataToInsert = this.input.useParam ? data : this.input.data.value;
      if (
        !this.input.useParam &&
        this.input.data.source === "js" &&
        typeof this.input.data.value === "string"
      ) {
        dataToInsert = (await this.context.vm.runAsync(
          this.input.data.value.slice(3),
        )) as object[];
      }
      if (!(dataToInsert instanceof Array)) {
        return {
          continueIfFail: false,
          successful: false,
          error: "error in insert bulk: data to insert is not an array",
        };
      }
      dataToInsert = await this.evaluateJsInData(dataToInsert);
      this.input.tableName = this.input.tableName.startsWith("js:")
        ? ((await this.context.vm.runAsync(
            this.input.tableName.slice(3),
          )) as string)
        : this.input.tableName;

      const result = await this.dbAdapter.insertBulk(
        this.input.tableName,
        dataToInsert,
      );
      return {
        continueIfFail: false,
        successful: true,
        output: result,
        next: this.next,
      };
    } catch {
      return {
        continueIfFail: false,
        successful: false,
        error: "failed to execute insert bulk db block",
      };
    }
  }
  private async evaluateJsInData(data: any[]): Promise<object[]> {
    const result: object[] = [];
    for (const item of data) {
      const queue: any[] = [];
      for (const key in item) {
        const value = item[key];
        if (typeof value === "string" && value.startsWith("js:")) {
          item[key] = await this.context.vm.runAsync(value.slice(3));
        } else if (typeof value === "object") {
          queue.push(value);
        }
      }
      // evaluating nested objects
      while (queue.length > 0) {
        const value = queue.shift()!;
        for (const key in value) {
          const item = value[key];
          if (typeof item === "string" && item.startsWith("js:")) {
            value[key] = await this.context.vm.runAsync(item.slice(3));
          } else if (typeof item === "object") {
            queue.push(item);
          }
        }
      }
      result.push(item);
    }
    return result;
  }
}
