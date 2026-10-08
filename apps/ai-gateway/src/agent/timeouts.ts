import {
	APICallError,
	type LanguageModel,
	type LanguageModelMiddleware,
	type Tool,
	wrapLanguageModel,
} from "ai";

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type Part = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

export type Limits = {
	/** A model call that sends no chunk for this long is aborted (and retried once if it sent nothing). */
	idleMs: number;
	/** Hard cap on one model call. */
	callMs: number;
	/** Cap on one tool call. */
	toolMs: number;
	/** Retries of a 429/5xx, passed to streamText (its backoff honours retry-after). */
	retries: number;
	/** Steps before asking to continue (default 40). */
	maxSteps?: number;
	/** Input + output tokens before asking to continue (default 1,000,000). */
	tokenBudget?: number;
	/** Cap on one tool result, start and end kept (default 50,000). */
	maxResultChars?: number;
	/** Context window in tokens; compaction trims at 60% and summarizes at 80% (default 128,000). */
	maxContextTokens?: number;
};

export const limitsFromEnv = (env: Record<string, string | undefined>): Limits => ({
	idleMs: Number(env.AGENT_CHUNK_TIMEOUT_MS) || 60_000,
	callMs: Number(env.AGENT_MODEL_TIMEOUT_MS) || 180_000,
	toolMs: Number(env.AGENT_TOOL_TIMEOUT_MS) || 120_000,
	retries: Number(env.AGENT_MAX_RETRIES ?? 5),
	maxSteps: Number(env.AGENT_MAX_STEPS) || undefined,
	tokenBudget: Number(env.AGENT_TOKEN_BUDGET) || undefined,
	maxResultChars: Number(env.AGENT_MAX_RESULT_CHARS) || undefined,
	maxContextTokens: Number(env.AGENT_MAX_CONTEXT_TOKENS) || undefined,
});

/**
 * Limits for a project's run: the project's AI settings (`settings.ai.*`, strings
 * as stored) with the CLI env on top. Unset or invalid values fall through to the
 * agent's own defaults, which match the project defaults.
 */
export const limitsFromProject = (
	settings: Record<string, string | undefined>,
	env: Record<string, string | undefined>,
): Limits => {
	const fromEnv = limitsFromEnv(env);
	return {
		...fromEnv,
		maxSteps: fromEnv.maxSteps ?? (Number(settings["settings.ai.maxSteps"]) || undefined),
		tokenBudget: fromEnv.tokenBudget ?? (Number(settings["settings.ai.tokenBudget"]) || undefined),
		maxContextTokens:
			fromEnv.maxContextTokens ?? (Number(settings["settings.ai.maxContextTokens"]) || undefined),
	};
};

class Timeout extends Error {
	constructor(
		readonly idle: boolean,
		message: string,
	) {
		super(message);
	}
}

const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

/** Sent before any content; held back so a retry does not repeat them downstream. */
const PRELUDE = new Set(["stream-start", "response-metadata", "raw"]);

/**
 * One model call under the idle and call caps. A call that sent no content
 * before going idle is retried once; anything else that times out ends the
 * call with a readable error part instead of hanging.
 */
async function* watched(
	call: (signal: AbortSignal) => PromiseLike<StreamResult>,
	parent: AbortSignal | undefined,
	{ idleMs, callMs }: Limits,
	onRetry: (why: string) => void,
): AsyncGenerator<Part> {
	for (let attempt = 0; ; attempt++) {
		const ctrl = new AbortController();
		const stop = () => ctrl.abort(parent?.reason);
		parent?.addEventListener("abort", stop, { once: true });
		const aborted = new Promise<never>((_, reject) =>
			ctrl.signal.addEventListener("abort", () => reject(ctrl.signal.reason), { once: true }),
		);
		aborted.catch(() => {});
		const cap = setTimeout(
			() =>
				ctrl.abort(
					new Timeout(
						false,
						`The model call passed the ${secs(callMs)} cap (AGENT_MODEL_TIMEOUT_MS).`,
					),
				),
			callMs,
		);
		let idle: ReturnType<typeof setTimeout> | undefined;
		const wait = async <T>(p: PromiseLike<T>) => {
			idle = setTimeout(
				() => ctrl.abort(new Timeout(true, `The model sent nothing for ${secs(idleMs)}.`)),
				idleMs,
			);
			try {
				return await Promise.race([p, aborted]);
			} finally {
				clearTimeout(idle);
			}
		};
		const held: Part[] = [];
		let sent = false;
		try {
			const reader = (await wait(call(ctrl.signal))).stream.getReader();
			try {
				for (let r = await wait(reader.read()); !r.done; r = await wait(reader.read())) {
					if (!sent && PRELUDE.has(r.value.type)) held.push(r.value);
					else {
						if (!sent) yield* held;
						sent = true;
						yield r.value;
					}
				}
				if (!sent) yield* held;
				return;
			} finally {
				reader.cancel().catch(() => {});
			}
		} catch (e) {
			const why = ctrl.signal.reason;
			if (parent?.aborted || !(why instanceof Timeout)) throw e;
			if (why.idle && !sent && attempt === 0) {
				onRetry(`${why.message} Retrying once.`);
				continue;
			}
			const message = attempt > 0 ? `${why.message} (after one retry)` : why.message;
			yield { type: "error", error: new Error(message) } as Part;
			return;
		} finally {
			clearTimeout(cap);
			parent?.removeEventListener("abort", stop);
		}
	}
}

/** A stream of `first` and then the rest of `it`. */
const toStream = <T>(it: AsyncGenerator<T>, first: IteratorResult<T>) => {
	let next: IteratorResult<T> | undefined = first;
	return new ReadableStream<T>({
		async pull(c) {
			const r = next ?? (await it.next());
			next = undefined;
			if (r.done) c.close();
			else c.enqueue(r.value);
		},
		async cancel() {
			await it.return(undefined);
		},
	});
};

/**
 * The model with every streaming call watched by `watched`. doStream waits for
 * the first part, so a failed connect (429, 5xx) rejects it and streamText
 * retries it with backoff; an error after content arrived is never retried.
 */
export function withModelTimeouts(
	model: Exclude<LanguageModel, string>,
	limits: Limits,
	onRetry: (why: string) => void,
) {
	let failures = 0;
	return wrapLanguageModel({
		model,
		middleware: {
			wrapStream: async ({ model, params }) => {
				const it = watched(
					(signal) => model.doStream({ ...params, abortSignal: signal }),
					params.abortSignal,
					limits,
					onRetry,
				);
				try {
					const first = await it.next();
					failures = 0;
					return { stream: toStream(it, first) };
				} catch (e) {
					// Same check as the SDK's retry, which has no hook of its own.
					if (APICallError.isInstance(e) && e.isRetryable && failures++ < limits.retries) {
						const what = [e.statusCode, e.message].filter(Boolean).join(" ");
						onRetry(`The model returned ${what}. Retrying (${failures}/${limits.retries}).`);
					}
					throw e;
				}
			},
		},
	});
}

/**
 * Every tool gets an abort signal that fires after `ms` or when the run is
 * stopped, which cancels its admin API request. The race is the safety net for
 * a tool that ignores the signal; the model reads the error as the result.
 */
export function withToolTimeouts(tools: Record<string, Tool>, ms: number): Record<string, Tool> {
	return Object.fromEntries(
		Object.entries(tools).map(([name, t]) => {
			const execute = t.execute;
			if (!execute) return [name, t];
			const run = (input: unknown, opts: Parameters<typeof execute>[1]) => {
				const ctrl = new AbortController();
				const failed = new Promise<never>((_, reject) =>
					ctrl.signal.addEventListener("abort", () => reject(ctrl.signal.reason), { once: true }),
				);
				const timer = setTimeout(
					() =>
						ctrl.abort(
							new Error(
								`${name} timed out after ${secs(ms)}. It may still finish on the server, so check before you retry it.`,
							),
						),
					ms,
				);
				const stop = () => ctrl.abort(new Error(`${name} was stopped.`));
				if (opts.abortSignal?.aborted) stop();
				opts.abortSignal?.addEventListener("abort", stop, { once: true });
				return Promise.race([
					execute(input, { ...opts, abortSignal: ctrl.signal }),
					failed,
				]).finally(() => {
					clearTimeout(timer);
					opts.abortSignal?.removeEventListener("abort", stop);
				});
			};
			return [name, { ...t, execute: run } as Tool];
		}),
	);
}
