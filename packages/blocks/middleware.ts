import type { BlockOutput, BlockTrace, BlockTraceSpan, Context } from "./baseBlock";
import { runCustomBlock } from "./builtin/customBlock";

/** a middleware (#534): its custom blocks, run in order, each passing its value on */
export type Middleware = { id: string; name: string; blocks: string[] };

/** a route's middlewares in run order */
export type RouteMiddlewares = { before: Middleware[]; after: Middleware[] };

type Phase = keyof RouteMiddlewares;

type RunRoute = (ctx: Context, input?: unknown) => Promise<BlockOutput | null>;

/** a Response, or a failure its own error handler did not answer, ends the chain */
const stops = (result: BlockOutput | undefined) =>
	Boolean(result?.responded || result?.successful === false);

function record(trace: BlockTrace | undefined, span: BlockTraceSpan) {
	try {
		trace?.recordSpan(span);
	} catch {
		// Telemetry must never change route execution.
	}
}

/**
 * Run one middleware's custom blocks. Traced (#579) as a `middleware` span
 * with one span per custom block under it, and that block's own spans under
 * those — without a trace this is just the loop.
 */
async function runMiddleware(
	ctx: Context,
	middleware: Middleware,
	input: unknown,
	phase: Phase,
	position: number,
) {
	const startedAt = performance.now();
	const blockId = `middleware:${middleware.id}`;
	// reserves this span's slot, so the custom blocks below can point at it
	const scope = ctx.trace?.enterCustomBlock({ blockId, name: middleware.name, detached: false });
	const inner = scope ? { ...ctx, trace: scope.trace } : ctx;

	let value = input;
	let result: BlockOutput | undefined;
	for (const block of middleware.blocks) {
		const stepStart = performance.now();
		const stepId = `${blockId}:${block}`;
		const out = await runCustomBlock(inner, block, value, stepId);
		record(inner.trace, {
			blockId: stepId,
			blockType: block,
			input: value,
			output: out?.output,
			startedAt: stepStart,
			endedAt: performance.now(),
			outcome: out?.successful === false ? "failure" : "success",
			...(out?.successful === false ? { error: out.error } : {}),
		});
		if (stops(out)) {
			result = out;
			break;
		}
		value = out?.output;
	}

	record(ctx.trace, {
		blockId,
		blockType: "middleware",
		blockName: middleware.name,
		middleware: { ...middleware, phase, position },
		input,
		output: result ? result.output : value,
		startedAt,
		endedAt: performance.now(),
		outcome: result?.successful === false ? "failure" : "success",
		...(result?.successful === false ? { error: result.error } : {}),
	});
	return { value, result };
}

/** Run a phase. Each middleware's output is the next one's input. */
async function runChain(ctx: Context, middlewares: Middleware[], input: unknown, phase: Phase) {
	let value = input;
	for (const [position, middleware] of middlewares.entries()) {
		const step = await runMiddleware(ctx, middleware, value, phase, position);
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
	const before = await runChain(ctx, middlewares.before, input, "before");
	const reply = before.result ?? (await run(ctx, before.value));
	if (!reply?.successful || middlewares.after.length === 0) return reply;

	const httpCode = reply.responded ? Number(reply.output?.httpCode) : 200;
	const body = reply.responded ? reply.output?.body : reply.output;
	// the reply stays readable for the whole after chain, even once a step has
	// reshaped `input` into something else
	ctx.vars.getResponseBody = () => body;
	ctx.vars.getResponseStatus = () => httpCode;
	const after = await runChain(ctx, middlewares.after, { httpCode, body }, "after");
	return (
		after.result ?? {
			successful: true,
			continueIfFail: true,
			responded: true,
			output: { httpCode: 200, body: after.value ?? null },
		}
	);
}
