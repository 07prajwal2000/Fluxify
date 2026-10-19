import { afterEach, describe, expect, it } from "bun:test";
import { CTX_SPAN_TYPE } from "../../baseBlock";
import { customBlockNames, lookupBlock, registerModuleBlock, unregisterBlock } from "../customBlock";
import { collectSpans, createContext } from "./compilerTestHelpers";

const PROJECT = "proj-1";
const TYPE = "acme/demo/spans";

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
});

/** runs a module block whose `run` is `body`, on a context with (or without) a trace */
async function runBlock(body: (ctx: any) => Promise<unknown>, withTrace = true) {
	registerModuleBlock(PROJECT, TYPE, async ({ ctx }) => ({ output: await body(ctx) }));
	const { spans, trace } = collectSpans();
	const ctx = { ...createContext(), ...(withTrace ? { trace } : {}) };
	const result = await lookupBlock(ctx, TYPE)(ctx, { params: {} });
	return { result, spans };
}

describe("ctx.span", () => {
	it("records a child span with its name and what fn returned", async () => {
		const { result, spans } = await runBlock((ctx) => ctx.span("fetch", () => 42));
		expect(result.output).toBe(42);
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({
			blockType: CTX_SPAN_TYPE,
			blockName: "fetch",
			outcome: "success",
			output: 42,
		});
		expect(spans[0].parent).toBeUndefined();
		expect(spans[0].endedAt).toBeGreaterThanOrEqual(spans[0].startedAt);
	});

	it("records a thrown error as a failure and rethrows it", async () => {
		const boom = new Error("boom");
		const { result, spans } = await runBlock((ctx) =>
			ctx.span("bad", async () => {
				throw boom;
			}),
		);
		expect(result).toMatchObject({ successful: false, error: boom });
		expect(spans[0]).toMatchObject({ blockName: "bad", outcome: "failure", error: boom });
	});

	it("nests a span opened inside fn under the enclosing one, also across concurrent calls", async () => {
		const { spans } = await runBlock((ctx) =>
			Promise.all([
				ctx.span("a", () => ctx.span("a1", () => ctx.span("a2", () => 1))),
				ctx.span("b", () => ctx.span("b1", async () => 2)),
			]),
		);
		const named = (name: string) => spans.find((s) => s.blockName === name)!;
		expect(named("a").parent).toBeUndefined();
		expect(named("a1").parent).toBe(named("a").blockId);
		expect(named("a2").parent).toBe(named("a1").blockId);
		expect(named("b1").parent).toBe(named("b").blockId);
		expect(new Set(spans.map((s) => s.blockId)).size).toBe(5);
	});

	it("only runs fn when there is no trace", async () => {
		const { result, spans } = await runBlock((ctx) => ctx.span("x", () => "ran"), false);
		expect(result.output).toBe("ran");
		expect(spans).toEqual([]);
	});
});
