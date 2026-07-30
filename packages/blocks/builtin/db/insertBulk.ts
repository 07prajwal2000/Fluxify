import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";
import { adapterFor, dbFailure } from "./schema";
import { emitJsObject } from "../../compiler";
import type { EmitNode } from "../../compiler";

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

export async function runInsertBulkDb(
  context: Context,
  connection: string,
  tableName: string,
  data: object[],
) {
  try {
    return await adapterFor(context, connection).insertBulk(tableName, data);
  } catch (error) {
    dbFailure("insert bulk", error);
  }
}

/** read without parsing — `data.value` is `z.object()`, which strips every key */
export function emitInsertBulkDb(node: EmitNode) {
  const input = node.block.data as z.infer<typeof insertBulkDbBlockSchema>;
  const data = node.v("data");
  const value = input.data.value;

  let payload: string;
  if (input.useParam) {
    payload = `await lib.evalJsDeep(ctx, ${node.in})`;
  } else if (input.data.source === "js" && typeof value === "string") {
    // matches the block: the stored string is expected to carry the js: prefix
    payload = `await lib.evalJsDeep(ctx, ${node.js(value.slice(3), node.in)})`;
  } else {
    payload = emitJsObject(value, node);
  }

  return `const ${data} = ${payload};
if (!Array.isArray(${data})) throw new Error("error in insert bulk: data to insert is not an array");
${node.in} = await lib.dbInsertBulk(ctx, ${JSON.stringify(input.connection)}, ${node.value(input.tableName)}, ${data});
${node.next()}`;
}

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
