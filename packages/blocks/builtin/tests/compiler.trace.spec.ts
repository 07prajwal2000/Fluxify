import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { BlockTraceSpan } from "../../baseBlock";
import { block, createContext, edge } from "./compilerTestHelpers";

describe("compileGraph tracing and edge validation", () => {
	it("reports one span per completed block without changing route execution", async () => {
		const spans: BlockTraceSpan[] = [];
		const ctx = createContext();
		ctx.trace = { recordSpan: (span: BlockTraceSpan) => spans.push(span) };
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
		expect(spans).toEqual([
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
	});

	it("records an error on the block that throws", async () => {
		const spans: BlockTraceSpan[] = [];
		const ctx = createContext();
		ctx.trace = { recordSpan: (span: BlockTraceSpan) => spans.push(span) };
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
		const spans: BlockTraceSpan[] = [];
		const ctx = createContext();
		ctx.trace = { recordSpan: (span: BlockTraceSpan) => spans.push(span) };
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
