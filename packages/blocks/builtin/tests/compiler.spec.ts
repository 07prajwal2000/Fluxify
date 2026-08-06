import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { BlockTraceSpan } from "../../baseBlock";
import type { EdgeDTOSchemaType } from "../../builderTypes";
import { block, createContext, edge, occurrences } from "./compilerTestHelpers";

describe("compileGraph", () => {
	it("compiles entrypoint -> setvar -> getvar -> jsrunner -> response", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.setvar, { key: "x", value: "js:return input.n * 2" }),
			block("3", BlockTypes.getvar, { key: "x" }),
			block("4", BlockTypes.jsrunner, { value: "return input + 1" }),
			block("5", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("1", "2"),
			edge("2", "3"),
			edge("3", "4"),
			edge("4", "5"),
		];

		const { run, source } = compileGraph(blocks, edges);
		expect(source).toContain('vars["x"]');

		const ctx = createContext();
		const result = await run(ctx, { n: 21 });

		expect(ctx.vars.x).toBe(42);
		expect(result).toEqual({
			successful: true,
			continueIfFail: true,
			output: { httpCode: "200", body: 43 },
		});
	});

	it("returns the flowing value when nothing is connected", async () => {
		const { run } = compileGraph([block("1", BlockTypes.entrypoint)], []);
		expect(await run(createContext(), { hello: "world" })).toEqual({
			successful: true,
			continueIfFail: true,
			output: { hello: "world" },
		});
	});

	it("inlines user JS: bare identifiers read and write context vars", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			// bare assignment must land in vars, not on the real globalThis
			block("2", BlockTypes.jsrunner, { value: "total = input.a + input.b; return total;" }),
			// a later block must see what the previous one assigned, and reach globals
			block("3", BlockTypes.jsrunner, { value: "return Math.max(total, input);" }),
			block("4", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [edge("1", "2"), edge("2", "3"), edge("3", "4")];

		const ctx = createContext();
		const result = await compileGraph(blocks, edges).run(ctx, { a: 2, b: 3 });

		expect(ctx.vars.total).toBe(5);
		expect((globalThis as any).total).toBeUndefined();
		expect(result.output.body).toBe(5);
		// `input` is the flowing value, and it no longer leaks into vars
		expect(ctx.vars.input).toBeUndefined();
	});

	it("inlines conditions, keeping the sandbox untouched", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.if, {
				conditions: [
					{ lhs: "js:return input.n", rhs: 10, operator: "gt", chain: "and" },
				],
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
			block("4", BlockTypes.response, { httpCode: "400" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("1", "2"),
			edge("2", "3", "success"),
			edge("2", "4", "failure"),
		];
		const { run, source } = compileGraph(blocks, edges);
		expect(source).not.toContain("ctx.vm");

		const successSpans: BlockTraceSpan[] = [];
		const successContext = createContext();
		successContext.trace = {
			recordSpan: (span: BlockTraceSpan) => successSpans.push(span),
		};
		expect((await run(successContext, { n: 42 })).output.httpCode).toBe("200");
		expect(successSpans.find((span) => span.blockId === "2")).toMatchObject({
			outcome: "success",
			branch: "success",
		});

		const failureSpans: BlockTraceSpan[] = [];
		const failureContext = createContext();
		failureContext.trace = {
			recordSpan: (span: BlockTraceSpan) => failureSpans.push(span),
		};
		expect((await run(failureContext, { n: 1 })).output.httpCode).toBe("400");
		expect(failureSpans.find((span) => span.blockId === "2")).toMatchObject({
			outcome: "success",
			branch: "failure",
		});
	});

	it("still routes through the sandbox when inlineJs is off", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, { value: "shared = input * 2; return shared;" }),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [edge("1", "2"), edge("2", "3")];
		const { run, source } = compileGraph(blocks, edges, { inlineJs: false });
		expect(source).toContain("ctx.vm.runAsync");

		const ctx = createContext();
		expect((await run(ctx, 21)).output.body).toBe(42);
		expect(ctx.vars.shared).toBe(42);
	});

	it("emits a shared tail once and reuses its block function", async () => {
		const blocks = [
			block("entry", BlockTypes.entrypoint),
			block("branch", BlockTypes.if, {
				conditions: [
					{ lhs: "js:return input", rhs: 0, operator: "gt", chain: "and" },
				],
			}),
			block("shared", BlockTypes.jsrunner, { value: "return input * 2;" }),
			block("response", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("entry", "branch"),
			edge("branch", "shared", "success"),
			edge("branch", "shared", "failure"),
			edge("shared", "response"),
		];

		const { run, source } = compileGraph(blocks, edges);
		expect(source.startsWith("/* fluxify-compiled-route-factory */")).toBe(true);
		expect(occurrences(source, "// jsrunner shared")).toBe(1);
		expect(occurrences(source, "async function $block_")).toBe(4);
		expect((await run(createContext(), 3)).output.body).toBe(6);
		expect((await run(createContext(), -2)).output.body).toBe(-4);
	});

	it("keeps generated source linear across repeated diamonds", () => {
		function graph(levels: number) {
			const blocks = [block("entry", BlockTypes.entrypoint)];
			const edges: EdgeDTOSchemaType = [edge("entry", "if-0")];

			for (let index = 0; index < levels; index++) {
				const id = "if-" + index;
				const next = index === levels - 1 ? "response" : "if-" + (index + 1);
				blocks.push(block(id, BlockTypes.if, { conditions: [] }));
				edges.push(edge(id, next, "success"), edge(id, next, "failure"));
			}
			blocks.push(block("response", BlockTypes.response, { httpCode: "200" }));
			return { blocks, edges };
		}

		const four = graph(4);
		const eight = graph(8);
		const shortSource = compileGraph(four.blocks, four.edges).source;
		const longSource = compileGraph(eight.blocks, eight.edges).source;

		expect(occurrences(longSource, "async function $block_")).toBe(10);
		expect(longSource.length).toBeLessThan(shortSource.length * 3);
	});

	it("preserves a response from a loop executor", async () => {
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("loop", BlockTypes.forloop, { start: 0, end: 2, step: 1 }),
				block("inside", BlockTypes.response, { httpCode: "201" }),
				block("after", BlockTypes.response, { httpCode: "200" }),
			],
			[
				edge("entry", "loop"),
				edge("loop", "inside", "executor"),
				edge("loop", "after"),
			],
		);

		expect((await run(createContext(), null)).output).toEqual({
			httpCode: "201",
			body: 0,
		});
	});

	it("runs each loop executor before its source continuation", async () => {
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("loop", BlockTypes.forloop, { start: 0, end: 3, step: 1 }),
				block("executor", BlockTypes.jsrunner, {
					value: "total = (total ?? 0) + input; return input;",
				}),
				block("total", BlockTypes.getvar, { key: "total" }),
				block("response", BlockTypes.response, { httpCode: "200" }),
			],
			[
				edge("entry", "loop"),
				edge("loop", "executor", "executor"),
				edge("loop", "total"),
				edge("total", "response"),
			],
		);

		expect((await run(createContext(), null)).output.body).toBe(3);
	});

	it("rejects cycles and unknown block types", () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.getvar, { key: "x" }),
		];
		expect(() =>
			compileGraph(blocks, [edge("1", "2"), edge("2", "1")]),
		).toThrow(/Cycle/);

		expect(() =>
			compileGraph(
				[block("1", BlockTypes.entrypoint), block("2", BlockTypes.sticky_note, {})],
				[edge("1", "2")],
			),
		).toThrow(/No codegen/);
	});
});
