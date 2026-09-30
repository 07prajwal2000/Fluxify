import type { BlockOutput, Context } from "./baseBlock";
import { runCustomBlock } from "./builtin/customBlock";

/** one link of a middleware chain: the custom block to run, and whose chain it is */
export type MiddlewareStep = { middlewareId: string; block: string };

/** a route's middlewares, flattened in run order — chains pass their value straight on */
export type RouteMiddlewares = { before: MiddlewareStep[]; after: MiddlewareStep[] };

type RunRoute = (ctx: Context, input?: unknown) => Promise<BlockOutput | null>;

/**
 * Run a chain. Each step's output is the next step's input; a Response ends the
 * chain, and so does a failure the step's own error handler did not answer.
 */
async function runChain(ctx: Context, steps: MiddlewareStep[], input: unknown) {
	let value = input;
	for (const step of steps) {
		const result = await runCustomBlock(ctx, step.block, value, `middleware:${step.middlewareId}`);
		if (result?.responded || result?.successful === false) return { value, result };
		value = result?.output;
	}
	return { value, result: undefined };
}

/**
 * The route as a sandwich (#534): before middlewares, the route, after middlewares.
 *
 * - a `before` Response skips the route but still goes through `after`
 * - `after` starts from `{ httpCode, body }` and runs whenever there is a reply
 * - an `after` chain that ends without a Response answers 200 with its last value
 * - a failure anywhere ends the request as-is; the route's error handler only
 *   ever sees the route's own errors
 */
export async function runWithMiddlewares(
	ctx: Context,
	input: unknown,
	run: RunRoute,
	middlewares: RouteMiddlewares | undefined,
): Promise<BlockOutput | null> {
	if (!middlewares) return run(ctx, input);
	const before = await runChain(ctx, middlewares.before, input);
	const reply = before.result ?? (await run(ctx, before.value));
	if (!reply?.successful || middlewares.after.length === 0) return reply;

	const httpCode = reply.responded ? Number(reply.output?.httpCode) : 200;
	const body = reply.responded ? reply.output?.body : reply.output;
	// the reply stays readable for the whole after chain, even once a step has
	// reshaped `input` into something else
	ctx.vars.getResponseBody = () => body;
	ctx.vars.getResponseStatus = () => httpCode;
	const after = await runChain(ctx, middlewares.after, { httpCode, body });
	return (
		after.result ?? {
			successful: true,
			continueIfFail: true,
			responded: true,
			output: { httpCode: 200, body: after.value ?? null },
		}
	);
}
