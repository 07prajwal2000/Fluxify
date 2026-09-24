import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { adapterFor, dbFailure } from "./schema";

export const transactionDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		executor: z
			.string()
			.describe("block id to start a transaction (database adapter state changes to transaction)"),
	})
	.extend(baseBlockDataSchema.shape);

export const transactionDbAiDescription = {
	name: BlockTypes.db_transaction,
	description:
		"Executes a sequence of database operations as a single atomic transaction. On commit the executor chain's last output flows to 'success'; on a rollback block or an error it rolls back and runs 'failure' with { reason: 'rollback' | 'error', message }.",
	jsonSchema: JSON.stringify(z.toJSONSchema(transactionDbBlockSchema)),
	handleInfo: `
Handles:
- 'executor': Connect the block to be executed inside the transaction.
- 'success': Runs after commit, with the executor chain's last output as input.
- 'failure': Runs after a rollback, with { reason, message } as input. When not connected, an error fails the route and a rollback ends it.`,
};

/** thrown by the rollback block; the enclosing transaction turns it into its failure branch */
export class TransactionRollback extends Error {
	constructor(readonly reason: string) {
		super("rollback block ran outside a database transaction");
	}
}

export type TransactionOutcome =
	| { result: unknown }
	| { failure: { reason: "rollback" | "error"; message: string } };

function errorMessage(error: unknown) {
	if (!(error instanceof Error)) return String(error);
	return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/**
 * Adapters with an open transaction. An adapter is per request and connection,
 * so a second transaction on it would join the first one and commit or roll
 * back both — refused instead.
 */
const openTransactions = new WeakSet<object>();

/**
 * `catchErrors` is off when nothing is wired to 'failure': an error then fails
 * the route as before, so the error handler still sees it.
 */
export async function runTransactionDb(
	context: Context,
	connection: string,
	body: () => Promise<unknown>,
	catchErrors = false,
): Promise<TransactionOutcome> {
	const adapter = adapterFor(context, connection);
	if (openTransactions.has(adapter)) {
		throw new Error("nested transactions on the same connection are not supported");
	}
	await adapter.startTransaction();
	openTransactions.add(adapter);
	try {
		const result = await body();
		await adapter.commitTransaction();
		return { result };
	} catch (error) {
		await adapter.rollbackTransaction();
		if (error instanceof TransactionRollback) {
			return { failure: { reason: "rollback", message: error.reason } };
		}
		if (!catchErrors) dbFailure("transaction", error);
		return { failure: { reason: "error", message: errorMessage(error) } };
	} finally {
		openTransactions.delete(adapter);
	}
}

/**
 * The executor chain runs inside the transaction callback and ends in
 * `$endBranch`, so its last output comes back wrapped. Anything else it
 * returns is a terminal block in there (a response), propagated out of the
 * graph instead of being swallowed.
 */
export function emitTransactionDb(node: EmitNode) {
	const input = transactionDbBlockSchema.parse(node.block.data);
	const tx = node.v("tx");
	return `const ${tx} = await lib.dbTransaction(ctx, ${node.value(input.connection)}, async () => {
${node.body("executor", "undefined", "$endBranch")}
}, ${node.has("failure")});
if ("failure" in ${tx}) {
${node.in} = ${tx}.failure;
${node.next("failure")}
}
if (${tx}.result !== undefined && !($branchEnd in ${tx}.result)) return ${tx}.result;
${node.in} = ${tx}.result?.[$branchEnd];
${node.next("success")}`;
}
