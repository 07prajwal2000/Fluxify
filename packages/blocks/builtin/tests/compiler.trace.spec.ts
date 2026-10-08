import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { BlockTraceSpan } from "../../baseBlock";
import { registerCustomBlock, unregisterCustomBlock } from "../customBlock";
import { block, collectSpans, createContext, edge } from "./compilerTestHelpers";

/** timings are real clock readings; assert them separately from the payload */
const withoutTiming = ({ startedAt, endedAt, ...span }: BlockTraceSpan) => span;

describe("compileGraph tracing and edge validation", () => {
	it("reports one span per completed block without changing route execution", async () => {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		const { run, source } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("double", BlockTypes.jsrunner, { value: "return input * 2;" }),
				block("response", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("entry", "double"), edge("double", "response")],
		);

		const result = await run(ctx, 21);

		expect(result.output).toEqual({ httpCode: "200", body: 42 });
		expect(source).toContain("if ($trace)");
		expect(source).not.toContain("function $recordSpan");
		expect(spans.map(withoutTiming)).toEqual([
			{
				blockId: "entry",
				blockType: BlockTypes.entrypoint,
				input: 21,
				output: 21,
				outcome: "success",
				position: { x: 0, y: 0 },
			},
			{
				blockId: "double",
				blockType: BlockTypes.jsrunner,
				input: 21,
				output: 42,
				outcome: "success",
				position: { x: 0, y: 0 },
			},
			{
				blockId: "response",
				blockType: BlockTypes.response,
				input: 42,
				output: {
					successful: true,
					continueIfFail: true,
					responded: true,
					output: { httpCode: "200", body: 42 },
				},
				outcome: "success",
				position: { x: 0, y: 0 },
			},
		]);
		for (const span of spans) {
			expect(span.endedAt).toBeGreaterThanOrEqual(span.startedAt);
		}
		// blocks run in order, so each span starts no earlier than the last ended
		expect(spans[1]!.startedAt).toBeGreaterThanOrEqual(spans[0]!.startedAt);
		expect(spans[2]!.startedAt).toBeGreaterThanOrEqual(spans[1]!.startedAt);
	});

	it("records an error on the block that throws", async () => {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("explode", BlockTypes.jsrunner, { value: "throw new Error('boom');" }),
			],
			[edge("entry", "explode")],
		);

		const result = await run(ctx, "input");

		expect(result.successful).toBe(false);
		expect(spans).toHaveLength(2);
		expect(spans[1]).toMatchObject({
			blockId: "explode",
			blockType: BlockTypes.jsrunner,
			input: "input",
			output: undefined,
			outcome: "failure",
		});
		expect(spans[1]?.error).toBeInstanceOf(Error);
	});

	it("attributes a loop executor's error to the executor, not the loop block", async () => {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("loop", BlockTypes.forloop, { start: 0, end: 3, step: 1 }),
				block("explode", BlockTypes.jsrunner, {
					value: "throw new Error('boom');",
				}),
			],
			[edge("entry", "loop"), edge("loop", "explode", "executor")],
		);

		const result = await run(ctx, null);

		expect(result.successful).toBe(false);
		const failures = spans.filter((span) => span.outcome === "failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]?.blockId).toBe("explode");
	});

	it("does not let a trace recorder failure fail a route", async () => {
		const ctx = createContext();
		ctx.trace = {
			...collectSpans().trace,
			recordSpan() {
				throw new Error("telemetry unavailable");
			},
		};
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("response", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("entry", "response")],
		);

		expect((await run(ctx, "safe")).output.body).toBe("safe");
	});

	it("scopes a custom block's spans to the block that invoked it", async () => {
		registerCustomBlock(
			"scoped_block",
			[
				block("inner-entry", BlockTypes.entrypoint),
				block("inner-double", BlockTypes.jsrunner, {
					value: "return input.value * 2;",
				}),
			],
			[edge("inner-entry", "inner-double")],
		);
		const { spans, entered, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("invoke", "scoped_block" as BlockTypes, { value: 21, invoke: "sync" }),
			],
			[edge("entry", "invoke")],
		);

		await run(ctx, null);

		expect(entered).toEqual([
			{ blockId: "invoke", name: "scoped_block", detached: false },
		]);
		// the nested graph's own blocks report too, so a trace can rebuild the tree
		expect(spans.map((span) => span.blockId)).toContain("inner-double");
		unregisterCustomBlock("scoped_block");
	});

	it("names spans after the block, ignoring the placeholder name", async () => {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint, { blockName: "Name" }),
				block("double", BlockTypes.jsrunner, {
					value: "return input * 2;",
					blockName: " Double it ",
				}),
			],
			[edge("entry", "double")],
		);

		await run(ctx, 21);

		expect(spans[0]).not.toHaveProperty("blockName");
		expect(spans[1]?.blockName).toBe("Double it");
	});

	describe("with tracing off", () => {
		const graph = (tracing = false) =>
			compileGraph(
				[
					block("entry", BlockTypes.entrypoint),
					block("orch", BlockTypes.orchestrator, { order: ["a", "b"] }),
					block("a", BlockTypes.jsrunner, { value: "return input * 2;" }),
					block("b", BlockTypes.jsrunner, { value: "return input + 1;" }),
					block("loop", BlockTypes.forloop, { start: 0, end: 2, step: 1 }),
					block("step", BlockTypes.jsrunner, { value: "return null;" }),
					block("response", BlockTypes.response, { httpCode: "200" }),
				],
				[
					edge("entry", "orch"),
					edge("orch", "a", "orchestrate"),
					edge("orch", "b", "orchestrate"),
					edge("orch", "loop"),
					edge("loop", "step", "executor"),
					edge("loop", "response"),
				],
				{ tracing },
			);

		it("emits no span code", () => {
			const { source } = graph();
			for (const marker of ["recordSpan", "$trace", "$t0", "$recorded"]) {
				expect(source).not.toContain(marker);
			}
		});

		it("runs the same and records nothing even with a trace attached", async () => {
			const { spans, trace } = collectSpans();
			const ctx = createContext();
			ctx.trace = trace;

			const result = await graph().run(ctx, 21);

			expect(result).toEqual(await graph(true).run(createContext(), 21));
			expect(result.successful).toBe(true);
			expect(spans).toEqual([]);
		});

		it("still fails a run whose block throws", async () => {
			const { run } = compileGraph(
				[
					block("entry", BlockTypes.entrypoint),
					block("explode", BlockTypes.jsrunner, { value: "throw new Error('boom');" }),
				],
				[edge("entry", "explode")],
				{ tracing: false },
			);

			const result = await run(createContext(), null);

			expect(result.successful).toBe(false);
			expect(String(result.error)).toContain("boom");
			// the block that threw, for the admin's debug errors (#671)
			expect((result.error as any)[Symbol.for("fluxify.block")]).toEqual({
				id: "explode",
				type: BlockTypes.jsrunner,
			});
		});
	});

	it("rejects multiple outgoing edges on one handle", () => {
		expect(() =>
			compileGraph(
				[
					block("entry", BlockTypes.entrypoint),
					block("first", BlockTypes.response, { httpCode: "200" }),
					block("second", BlockTypes.response, { httpCode: "201" }),
				],
				[edge("entry", "first"), edge("entry", "second")],
			),
		).toThrow(/multi-edge fan-out/);
	});
});

describe("span details for the run viewer (#628)", () => {
	it("bakes each block's position in, records the whole request on the entrypoint and a switch's pick", async () => {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		ctx.traceInput = { method: "GET", headers: { "x-key": "k" }, query: { q: "1" }, body: 7 };
		const { run, source } = compileGraph(
			[
				{ ...block("entry", BlockTypes.entrypoint), position: { x: 10, y: 20 } },
				block("sw", BlockTypes.switch, { conditions: { a: "js:return false;", b: "js:return true;" } }),
				block("a", BlockTypes.jsrunner, { value: "return 'a';" }),
				block("b", BlockTypes.jsrunner, { value: "return 'b';" }),
			],
			[edge("entry", "sw"), edge("sw", "a", "case"), edge("sw", "b", "case")],
		);

		expect((await run(ctx, 7)).output).toBe("b");
		const [entry, sw] = spans;
		expect(entry).toMatchObject({ position: { x: 10, y: 20 }, input: ctx.traceInput, output: 7 });
		expect(sw).toMatchObject({ blockId: "sw", next: "b", input: 7 });
		// spans compiled out: no position, no request, nothing
		expect(compileGraph([block("e", BlockTypes.entrypoint)], [], { tracing: false }).source).not.toContain(
			"traceInput",
		);
		expect(source).toContain("ctx.traceInput");
	});
});
