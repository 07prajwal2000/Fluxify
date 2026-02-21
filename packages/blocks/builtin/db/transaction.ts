import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import { IDbAdapter } from "@fluxify/adapters";
import { Engine } from "../../engine";

export const transactionDbBlockSchema = z
  .object({
    connection: z.string().describe("integration id"),
    executor: z
      .string()
      .describe(
        "block id to start a transaction (database adapter state changes to transaction)",
      ),
  })
  .extend(baseBlockDataSchema.shape);

export const transactionDbAiDescription = {
  name: "db_transaction",
  description:
    "Executes a sequence of database operations as a single atomic transaction.",
  jsonSchema: JSON.stringify(z.toJSONSchema(transactionDbBlockSchema)),
  handleInfo: `
Handles:
- 'executor': Connect the block to be executed inside the transaction.`,
};

export class TransactionBlock extends BaseBlock {
  constructor(
    protected readonly context: Context,
    private readonly dbAdapter: IDbAdapter,
    protected readonly input: z.infer<typeof transactionDbBlockSchema>,
    protected readonly childEngine: Engine,
    public readonly next?: string,
  ) {
    super(context, input, next);
  }

  public async executeAsync(): Promise<BlockOutput> {
    try {
      await this.dbAdapter.startTransaction();
      const result = await this.childEngine.start(this.input.executor);
      await this.dbAdapter.commitTransaction();
      return result
        ? result
        : {
            continueIfFail: false,
            successful: false,
            error: "failed to execute transaction block",
          };
    } catch (error) {
      await this.dbAdapter.rollbackTransaction();
      return {
        continueIfFail: false,
        successful: false,
        error: "failed to execute transaction block",
      };
    }
  }
}
