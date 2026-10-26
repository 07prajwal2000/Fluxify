import { describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { block, createContext, edge, occurrences } from "./compilerTestHelpers";

const tagOf = (error: unknown) => (error as Record<symbol, unknown>)[Symbol.for("fluxify.block")];

// the generated shape (#944): pure expressions inline, tail calls unawaited, plain functions where nothing waits
describe("compiled block functions", () => {
	it("inlines pure expressions and skips the scope proxy when nothing needs it", async () => {
		const { run, source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.setvar, { key: "x", value: "js:return input.n * 2" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);
		expect(source).not.toContain("with ($scope)");
		expect(source).toContain("scope: undefined,");
		expect(occurrences(source, "async function $block_")).toBe(0);
		// only $run awaits: its catch and finally must see the whole chain
		expect(occurrences(source, "return await $block_")).toBe(1);

		const ctx = createContext();
		expect((await run(ctx, { n: 21 })).output).toEqual({ httpCode: "200", body: 42 });
		expect(ctx.vars.x).toBe(42);
	});

	it("keeps the scope for code that reads graph variables by name", async () => {
		const { run, source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.setvar, { key: "x", value: "js:return 5" }),
				block("3", BlockTypes.jsrunner, { value: "const y = 1; return x + y + input" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);
		expect(source).toContain("scope: lib.scope(vars),");
		// x and the flowing input are both the 5 setvar wrote
		expect((await run(createContext(), 10)).output).toBe(11);
	});

	it.each([true, false])("tags an error with the block that threw, tracing %p", async (tracing) => {
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				// waits, so it stays async and calls the next block as a tail call
				block("wait", BlockTypes.jsrunner, { value: "await null; return input" }),
				// pure and synchronous: throws from a plain function
				block("explode", BlockTypes.setvar, { key: "x", value: "js:return input.a.b" }),
				block("res", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("entry", "wait"), edge("wait", "explode"), edge("explode", "res")],
			{ tracing },
		);
		const result = await run(createContext(), null);
		expect(result.successful).toBe(false);
		expect(result.error).toBeInstanceOf(TypeError);
		expect(tagOf(result.error)).toEqual({ id: "explode", type: BlockTypes.setvar });
	});

	it("keeps a parallel branch async, so a synchronous throw still settles into its slot", async () => {
		const { run } = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("orch", BlockTypes.orchestrator, { onError: "settle", order: ["a", "b"] }),
				block("a", BlockTypes.setvar, { key: "x", value: "js:return input.a.b" }),
				block("b", BlockTypes.jsrunner, { value: "return 1" }),
				block("res", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("entry", "orch"), edge("orch", "a", "orchestrate"), edge("orch", "b", "orchestrate"), edge("orch", "res")],
		);
		const body = (await run(createContext(), null)).output.body;
		expect(body[0]).toStartWith("TypeError");
		expect(body[1]).toBe(1);
	});
});
