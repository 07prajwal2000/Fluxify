import { createSpan } from "@fluxify/sdk/runtime";
import { type Context, CTX_SPAN_TYPE } from "../baseBlock";

/**
 * `ctx.span` for a programmable block's `run`: records `fn` as a child span of
 * the block, with outcome and error from whether it threw (rethrown). With no
 * trace it only runs `fn`. Nesting and timing are the SDK's, shared with the
 * test harness.
 */
export function withCtxSpan(ctx: Context): Context {
	const trace = ctx.trace;
	const span = createSpan(
		trace &&
			(({ id, name, parent, ...rest }) =>
				trace.recordSpan({
					blockId: id,
					blockType: CTX_SPAN_TYPE,
					blockName: name,
					...(parent ? { parent } : {}),
					input: undefined,
					...rest,
				})),
	);
	return { ...ctx, span };
}
