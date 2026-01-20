import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import type { IDbAdapter } from "@fluxify/adapters";
import { whereConditionSchema } from "./schema";

export const getAllDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    tableName: z.string().describe("table name (supports js expression)"),
    conditions: z.array(whereConditionSchema).describe("list of conditions"),
    limit: z
      .int()
      .or(z.string())
      .default(1000)
      .describe("limit (supports js expressions)"),
    offset: z
      .int()
      .or(z.string())
      .default(0)
      .describe("skip count (supports js expressions)"),
    sort: z
      .object({
        attribute: z.string().describe("sort attribute"),
        direction: z.enum(["asc", "desc"]).describe("type of sort"),
      })
      .default({
        attribute: "id",
        direction: "asc",
      }),
  })
  .extend(baseBlockDataSchema.shape);

export const getAllDbAiDescription = {
  name: "db_get_all",
  description: `gets multiple records from a database table with optional conditions, sorting, limit, and offset`,
  jsonSchema: JSON.stringify(z.toJSONSchema(getAllDbBlockSchema)),
};

export class GetAllDbBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof getAllDbBlockSchema>,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(): Promise<BlockOutput> {
    try {
      this.input.tableName = this.input.tableName.startsWith("js:")
        ? ((await this.context.vm.runAsync(
            this.input.tableName.slice(3),
          )) as string)
        : this.input.tableName;
      this.input.sort.attribute = this.input.sort.attribute.startsWith("js:")
        ? ((await this.context.vm.runAsync(
            this.input.sort.attribute.slice(3),
          )) as string)
        : this.input.sort.attribute;
      let limit =
        typeof this.input.limit === "string" &&
        this.input.limit.startsWith("js:")
          ? Number(await this.context.vm.runAsync(this.input.limit.slice(3)))
          : Number(this.input.limit);
      let offset =
        typeof this.input.offset === "string" &&
        this.input.offset.startsWith("js:")
          ? Number(await this.context.vm.runAsync(this.input.offset.slice(3)))
          : Number(this.input.offset);
      offset = isNaN(offset) ? 0 : offset;
      limit = isNaN(limit) ? 1000 : limit;
      const result = await this.dbAdapter.getAll(
        this.input.tableName,
        this.input.conditions,
        limit,
        offset,
        this.input.sort ?? {
          attribute: "id",
          direction: "asc",
        },
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
        error: "failed to execute get all db block",
      };
    }
  }
}
