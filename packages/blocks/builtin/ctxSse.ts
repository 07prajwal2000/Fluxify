import type { SseContext } from "@fluxify/sdk/blocks";
import type { Context } from "../baseBlock";

/**
 * `ctx.sse` for a plugin block (#1025): the run's own `sse` (#1023) without
 * `connect` or `connectionId`, which are the route's. Read on each call, so a
 * run with no `sse` fails only when a block uses it.
 */
export function withCtxSse(ctx: Context): Context {
	const sse = () => {
		if (!ctx.vars.sse) throw new Error("ctx.sse is not available in this run");
		return ctx.vars.sse;
	};
	const api: SseContext = {
		send: (handle, data, options) => sse().send(handle, data, options),
		close: (handle) => sse().close(handle),
		signal: (handle) => sse().signal(handle),
	};
	return { ...ctx, sse: api };
}
