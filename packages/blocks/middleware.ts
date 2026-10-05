import type { BlockOutput, Context } from "./baseBlock";
import { runCustomBlock } from "./builtin/customBlock";

/** a middleware (#534): its custom blocks, run in order, each passing its value on */
export type Middleware = { id: string; name: string; blocks: string[] };

/** a route's middlewares in run order */
export type RouteMiddlewares = { before: Middleware[]; after: Middleware[] };

type RunRoute = (ctx: Context, input?: unknown) => Promise<BlockOutput | null>;

/** a Response, or a failure its own error handler did not answer, ends the chain */
const stops = (result: BlockOutput | undefined) =>
	Boolean(result?.responded || result?.successful === false);

/** Run one middleware's custom blocks. */
async function runMiddleware(ctx: Context, middleware: Middleware, input: unknown) {
	let value = input;
	for (const block of middleware.blocks) {
		const result = await runCustomBlock(ctx, block, value, `middleware:${middleware.id}`);
		if (stops(result)) return { value, result };
		value = result?.output;
	}
	return { value, result: undefined };
}

/** Run a phase. Each middleware's output is the next one's input. */
async function runChain(ctx: Context, middlewares: Middleware[], input: unknown) {
	let value = input;
	for (const middleware of middlewares) {
		const step = await runMiddleware(ctx, middleware, value);
		if (step.result) return step;
		value = step.value;
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
