import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";
import { whereConditionSchema } from "./schema";

export const updateDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    conditions: z.array(whereConditionSchema).describe("list of conditions"),
    data: z.object({
      source: z.enum(["raw", "js"]).describe("source of the value"),
      value: z
        .object()
        .describe("value to insert (object values can be js expression)"),
    }),
    useParam: z.boolean().describe("use parameter"),
  })
  .extend(baseBlockDataSchema.shape);

export const updateDbAiDescription = {
  name: "db_update",
  description: `updates one or more database records using a specified table, conditions, and data `,
  jsonSchema: JSON.stringify(z.toJSONSchema(updateDbBlockSchema)),
};

export class UpdateDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof updateDbBlockSchema>,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(data: object): Promise<BlockOutput> {
    try {
      let dataToUpdate = this.input.useParam ? data : this.input.data.value;
      if (
        !this.input.useParam &&
        this.input.data.source === "js" &&
        typeof this.input.data.value === "string"
      ) {
        dataToUpdate = (await this.context.vm.runAsync(
          this.input.data.value,
        )) as object;
      }
      if (!(typeof dataToUpdate === "object")) {
        return {
          continueIfFail: false,
          successful: false,
          error: "error in update: data to update is not an object",
        };
      }
      dataToUpdate = await this.evaluateJsInData(dataToUpdate);
      this.input.tableName = this.input.tableName.startsWith("js:")
        ? ((await this.context.vm.runAsync(
            this.input.tableName.slice(3),
          )) as string)
        : this.input.tableName;
      const result = await this.dbAdapter.update(
        this.input.tableName,
        dataToUpdate,
        this.input.conditions,
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
        error: "failed to execute update db block",
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
