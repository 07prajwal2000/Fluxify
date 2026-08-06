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
			},
			{
				blockId: "double",
				blockType: BlockTypes.jsrunner,
				input: 21,
				output: 42,
				outcome: "success",
			},
			{
				blockId: "response",
				blockType: BlockTypes.response,
				input: 42,
				output: {
					successful: true,
					continueIfFail: true,
					output: { httpCode: "200", body: 42 },
				},
				outcome: "success",
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
