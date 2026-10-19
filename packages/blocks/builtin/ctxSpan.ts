import { AsyncLocalStorage } from "node:async_hooks";
import { type Context, CTX_SPAN_TYPE } from "../baseBlock";

/** the innermost running `ctx.span`, so a span opened inside `fn` nests under it */
const current = new AsyncLocalStorage<string>();

/**
 * `ctx.span` for a programmable block's `run`: records `fn` as a child span of
 * the block, with outcome and error from whether it threw (rethrown). With no
 * trace it only runs `fn`.
 */
export function withCtxSpan(ctx: Context): Context {
	const span: NonNullable<Context["span"]> = async (name, fn) => {
		const trace = ctx.trace;
		if (!trace) return fn();
		const id = crypto.randomUUID();
		const parent = current.getStore();
		const startedAt = performance.now();
		const record = (output: unknown, error?: unknown) => {
			try {
				trace.recordSpan({
					blockId: id,
					blockType: CTX_SPAN_TYPE,
					blockName: name,
					...(parent ? { parent } : {}),
					input: undefined,
					output,
					startedAt,
					endedAt: performance.now(),
					outcome: error === undefined ? "success" : "failure",
					...(error === undefined ? {} : { error }),
				});
			} catch {
				// Telemetry must never change execution.
			}
		};
		try {
			const output = await current.run(id, fn);
			record(output);
			return output;
		} catch (error) {
			record(undefined, error ?? new Error("thrown undefined"));
			throw error;
		}
	};
	return { ...ctx, span };
}
