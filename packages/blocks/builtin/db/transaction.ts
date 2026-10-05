import {
	type IDbAdapter,
	type IsolationLevel,
	isRetryableTransactionError,
	isTransactionUnsupported,
	MONGO_NO_REPLICA_SET,
} from "@fluxify/adapters";
import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { adapterFor, dbFailure, transactionAttempts } from "./schema";

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;

/** the settings panel stores numbers as text, and a cleared field (or "default") means unset */
const unset = (value: unknown) =>
	value === "" || value === null || value === "default" ? undefined : value;

export const transactionDbBlockSchema = z
	.object({
		connection: z.string().describe("integration id"),
		executor: z
			.string()
			.describe("block id to start a transaction (database adapter state changes to transaction)"),
		timeoutMs: z
			.preprocess(unset, z.coerce.number().int().positive().default(DEFAULT_TRANSACTION_TIMEOUT_MS))
			.describe(
				"milliseconds the whole transaction may take, retries included; past it the transaction rolls back and runs 'failure' with reason 'timeout'",
			),
		isolation: z
			.preprocess(unset, z.enum(["read_committed", "repeatable_read", "serializable"]).optional())
			.describe(
				"isolation level; left out means the database's default. PostgreSQL and MySQL only, MongoDB has no levels",
			),
		retries: z
			.preprocess(unset, z.coerce.number().int().min(0).max(10).default(0))
			.describe(
				"extra attempts after a deadlock or serialization failure. Each attempt re-runs the whole executor chain, including non-database calls such as HTTP requests",
			),
	})
	.extend(baseBlockDataSchema.shape);

export const transactionDbAiDescription = {
	name: BlockTypes.db_transaction,
	description:
		"Executes a sequence of database operations as a single atomic transaction. On commit the executor chain's last output flows to 'success'; on a rollback block, an error or its timeout it rolls back and runs 'failure' with { reason: 'rollback' | 'error' | 'timeout', message }. Deadlocks and serialization failures can be retried with 'retries'.",
	jsonSchema: JSON.stringify(z.toJSONSchema(transactionDbBlockSchema)),
	handleInfo: `
Handles:
- 'executor': Connect the block to be executed inside the transaction.
- 'success': Runs after commit, with the executor chain's last output as input.
- 'failure': Runs after a rollback, with { reason, message } as input. When not connected, an error or timeout fails the route and a rollback ends it.`,
};

/** thrown by the rollback block; the enclosing transaction turns it into its failure branch */
export class TransactionRollback extends Error {
	constructor(readonly reason: string) {
		super("rollback block ran outside a database transaction");
	}
}

class TransactionTimeout extends Error {}

export type TransactionOutcome =
	| { result: unknown }
	| { failure: { reason: "rollback" | "error" | "timeout"; message: string } };

export type TransactionOptions = {
	timeoutMs?: number;
	isolation?: IsolationLevel;
	retries?: number;
};

export function errorMessage(error: unknown) {
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
 *
 * `timeoutMs` covers every attempt together. A deadlock or serialization
 * failure runs the whole body again, up to `retries` more times.
 */
export async function runTransactionDb(
	context: Context,
	connection: string,
	body: () => Promise<unknown>,
	catchErrors = false,
	{ timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS, isolation, retries = 0 }: TransactionOptions = {},
): Promise<TransactionOutcome> {
	const adapter = adapterFor(context, connection);
	if (openTransactions.has(adapter)) {
		throw new Error("nested transactions on the same connection are not supported");
	}
	const deadline = Date.now() + timeoutMs;
	openTransactions.add(adapter);
	try {
		for (let attempt = 0; ; attempt++) {
			try {
				return { result: await runAttempt(adapter, body, isolation, deadline, timeoutMs) };
			} catch (error) {
				if (attempt < retries && isRetryableTransactionError(error) && Date.now() < deadline) {
					// 25, 50, 100ms... plus jitter, so both sides of a deadlock do not collide again
					await Bun.sleep(Math.min(25 * 2 ** attempt + Math.random() * 25, deadline - Date.now()));
					continue;
				}
				return failureOf(error, catchErrors);
			}
		}
	} finally {
		openTransactions.delete(adapter);
	}
}

/**
 * One try: begin, run the body against the time left, commit. A commit can
 * fail too (a serialization failure often shows there); the adapter has let go
 * of the transaction by then, so no rollback follows it.
 */
async function runAttempt(
	adapter: IDbAdapter,
	body: () => Promise<unknown>,
	isolation: IsolationLevel | undefined,
	deadline: number,
	timeoutMs: number,
) {
	await adapter.startTransaction(isolation);
	const attempt = { timedOut: false };
	const running = transactionAttempts.run(
		[...(transactionAttempts.getStore() ?? []), attempt],
		body,
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			attempt.timedOut = true;
			reject(new TransactionTimeout(`transaction timed out after ${timeoutMs}ms`));
		}, deadline - Date.now());
	});
	let result: unknown;
	try {
		result = await Promise.race([running, timeout]);
	} catch (error) {
		// a timed-out body is still running; whatever it ends with is dropped
		running.catch(() => {});
		// the rollback's own error would hide why the transaction failed
		await adapter.rollbackTransaction().catch(() => {});
		throw error;
	} finally {
		clearTimeout(timer);
	}
	await adapter.commitTransaction();
	return result;
}

function failureOf(error: unknown, catchErrors: boolean): TransactionOutcome {
	if (error instanceof TransactionRollback) {
		return { failure: { reason: "rollback", message: error.reason } };
	}
	const reason = error instanceof TransactionTimeout ? "timeout" : "error";
	if (isTransactionUnsupported(error) || isTransactionUnsupported((error as Error)?.cause)) {
		error = new Error(MONGO_NO_REPLICA_SET);
	}
	if (!catchErrors) dbFailure("transaction", error);
	return { failure: { reason, message: errorMessage(error) } };
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
	const options = JSON.stringify({
		timeoutMs: input.timeoutMs,
		isolation: input.isolation,
		retries: input.retries,
	});
	return `const ${tx} = await lib.dbTransaction(ctx, ${node.value(input.connection)}, async () => {
${node.body("executor", "undefined", "$endBranch")}
}, ${node.has("failure")}, ${options});
if ("failure" in ${tx}) {
${node.in} = ${tx}.failure;
${node.next("failure")}
}
if (${tx}.result !== undefined && !($branchEnd in ${tx}.result)) return ${tx}.result;
${node.in} = ${tx}.result?.[$branchEnd];
${node.next("success")}`;
}
