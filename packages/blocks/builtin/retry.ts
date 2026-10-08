import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";
import { transactionAttempts } from "./db/schema";
import { errorMessage, TransactionRollback } from "./db/transaction";

export const RETRY_TYPES = [
	"none",
	"fixed",
	"linear",
	"exponential",
	"exponential_jitter",
] as const;
export type RetryType = (typeof RETRY_TYPES)[number];

/** one wait may not pass this, so 10 retries cannot hang a route for long */
export const MAX_RETRY_WAIT_MS = 30_000;

/** the settings panel stores numbers as text, and a cleared field means unset */
const unset = (value: unknown) => (value === "" || value === null ? undefined : value);
const waitMs = (fallback: number) =>
	z.preprocess(unset, z.coerce.number().int().min(0).max(MAX_RETRY_WAIT_MS).default(fallback));

export const retryBlockSchema = z
	.object({
		maxRetries: z
			.preprocess(unset, z.coerce.number().int().min(1).max(10).default(3))
			.describe("retries after the first try, 1 to 10 — so up to 11 runs"),
		retryType: z
			.preprocess(unset, z.enum(RETRY_TYPES).default("fixed"))
			.describe(
				"wait before retry N: none = 0, fixed = delay, linear = delay*N, exponential = delay*2^(N-1), exponential_jitter = random 0..exponential",
			),
		delayMs: waitMs(1000).describe("starting wait in milliseconds; unused by 'none'"),
		maxDelayMs: waitMs(MAX_RETRY_WAIT_MS).describe("cap on each single wait in milliseconds"),
	})
	.extend(baseBlockDataSchema.shape);

export const retryAiDescription = {
	name: BlockTypes.retry,
	description:
		"Runs its executor chain and, when it throws, runs it again up to 'maxRetries' more times with a wait between tries. Then the chain's last output goes to 'success', or { attempts, message } goes to 'failure'. Retrying a write can run it more than once.",
	jsonSchema: JSON.stringify(z.toJSONSchema(retryBlockSchema)),
	output: "On 'success': the executor chain's last output. On 'failure': { attempts, message }.",
	example: { maxRetries: 3, retryType: "exponential", delayMs: 500, maxDelayMs: 5000 },
	handleInfo: `
Handles:
- 'executor': Connect the first block to retry. It gets this block's input on every try.
- 'success': Runs after a try finishes without error, with the executor chain's last output as input.
- 'failure': Runs when every try failed, with { attempts, message } as input. When not connected, the last error fails the route.`,
};

export type RetryOptions = {
	maxRetries: number;
	retryType: RetryType;
	delayMs: number;
	maxDelayMs: number;
};
export type RetryOutcome = { result: unknown } | { failure: { attempts: number; message: string } };

/** wait before retry `n` (1-based), capped by `maxDelayMs` */
export function retryWait(n: number, { retryType, delayMs, maxDelayMs }: RetryOptions) {
	const exponential = delayMs * 2 ** (n - 1);
	const wait = {
		none: 0,
		fixed: delayMs,
		linear: delayMs * n,
		exponential,
		// "full jitter": callers that failed together spread out instead of retrying together
		exponential_jitter: Math.random() * Math.min(exponential, maxDelayMs),
	}[retryType];
	return Math.min(wait, maxDelayMs);
}

/** setTimeout rather than Bun.sleep, so fake timers drive it in tests */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A rollback block, or the enclosing transaction timing out, is a deliberate
 * stop for the whole transaction — another try cannot change that.
 */
const passesThrough = (error: unknown) =>
	error instanceof TransactionRollback ||
	!!transactionAttempts.getStore()?.some((attempt) => attempt.timedOut);

/**
 * `catchErrors` is off when nothing is wired to 'failure': the last error then
 * fails the route as it would without the block.
 */
export async function runRetry(
	body: () => Promise<unknown>,
	catchErrors: boolean,
	options: RetryOptions,
): Promise<RetryOutcome> {
	for (let attempt = 1; ; attempt++) {
		try {
			return { result: await body() };
		} catch (error) {
			if (passesThrough(error)) throw error;
			if (attempt <= options.maxRetries) {
				await sleep(retryWait(attempt, options));
				continue;
			}
			if (!catchErrors) throw error;
			return { failure: { attempts: attempt, message: errorMessage(error) } };
		}
	}
}

/**
 * Same shape as the transaction: the executor chain ends in `$endBranch`, so a
 * wrapped value is its last output, and anything else is a terminal block in
 * there (a response) leaving the graph — no retry.
 */
export function emitRetry(node: EmitNode) {
	const { maxRetries, retryType, delayMs, maxDelayMs } = retryBlockSchema.parse(node.block.data);
	const r = node.v("retry");
	const input = node.v("retryIn");
	const options = JSON.stringify({ maxRetries, retryType, delayMs, maxDelayMs });
	return `const ${input} = ${node.in};
const ${r} = await lib.retry(async () => {
${node.body("executor", input, "$endBranch")}
}, ${node.has("failure")}, ${options});
if ("failure" in ${r}) {
${node.in} = ${r}.failure;
${node.next("failure")}
}
if (${r}.result !== undefined && !($branchEnd in ${r}.result)) return ${r}.result;
${node.in} = ${r}.result?.[$branchEnd];
${node.next("success")}`;
}
