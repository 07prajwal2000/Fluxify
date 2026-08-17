import { BlockTypes } from "../../blockTypes";
import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import { IDbAdapter } from "@fluxify/adapters";
import { logger } from "@fluxify/common";
import { adapterFor, dbFailure } from "./schema";
import { emitJsObject } from "../../compiler";
import type { EmitNode } from "../../compiler";

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
  name: BlockTypes.db_insert,
  description:
    "Inserts a single record into a database table.",
  jsonSchema: JSON.stringify(z.toJSONSchema(insertDbBlockSchema)),
};

export async function runInsertDb(
  context: Context,
  connection: string,
  tableName: string,
  data: object,
) {
  try {
    return await adapterFor(context, connection).insert(tableName, data);
  } catch (error) {
    dbFailure("insert", error);
  }
}

/**
 * A literal payload is walked at compile time, so its `js:` values become
 * inlined code. A payload that only exists at runtime is data: it is forwarded
 * unchanged and can never introduce a new executable `js:` expression.
 *
 * Read without parsing: the schema types `data.value` as an object, but the
 * block also accepts a string there when `source` is "js".
 */
export function emitInsertDb(node: EmitNode) {
  const input = node.block.data as z.infer<typeof insertDbBlockSchema>;
  const data = node.v("data");
  const value = input.data.value as unknown;

  let payload: string;
  if (input.useParam) {
    payload = node.in;
  } else if (input.data.source === "js" && typeof value === "string") {
    payload = node.js(value, node.in);
  } else {
    payload = emitJsObject(value, node);
  }

  return `const ${data} = ${payload};
if (typeof ${data} !== "object") throw new Error("error in insert: data to insert is not an object");
${node.in} = await lib.dbInsert(ctx, ${node.value(input.connection)}, ${node.value(input.tableName)}, ${data});
${node.next()}`;
}

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
      logger.error("Failed to execute insert db block", "BLOCKS.insert", { error: e });
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
