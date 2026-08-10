import { BlockTypes } from "../../blockTypes";
import z from "zod";
import {
  baseBlockDataSchema,
  BaseBlock,
  BlockOutput,
  Context,
} from "../../baseBlock";
import { IDbAdapter } from "@fluxify/adapters";
import { Engine } from "../../engine";
import { adapterFor, dbFailure } from "./schema";
import type { EmitNode } from "../../compiler";

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
  name: BlockTypes.db_transaction,
  description:
    "Executes a sequence of database operations as a single atomic transaction.",
  jsonSchema: JSON.stringify(z.toJSONSchema(transactionDbBlockSchema)),
  handleInfo: `
Handles:
- 'executor': Connect the block to be executed inside the transaction.`,
};

export async function runTransactionDb(
  context: Context,
  connection: string,
  body: () => Promise<unknown>,
) {
  const adapter = adapterFor(context, connection);
  await adapter.startTransaction();
  try {
    const result = await body();
    await adapter.commitTransaction();
    return result;
  } catch (error) {
    await adapter.rollbackTransaction();
    dbFailure("transaction", error);
  }
}

/**
 * The executor chain runs inside the transaction callback. A terminal block in
 * there (a response) emits its own `return`, which lands as the callback's
 * result — so it is propagated out of the graph instead of being swallowed.
 */
export function emitTransactionDb(node: EmitNode) {
  const input = transactionDbBlockSchema.parse(node.block.data);
  const result = node.v("tx");
  return `const ${result} = await lib.dbTransaction(ctx, ${JSON.stringify(input.connection)}, async () => {
${node.body("executor", "undefined")}
});
if (${result} !== undefined) return ${result};
${node.in} = undefined;
${node.next()}`;
}

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
