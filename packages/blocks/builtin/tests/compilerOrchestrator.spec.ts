import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { block, createContext, edge } from "./compilerTestHelpers";

const sleep = (ms: number) => `await new Promise((r) => setTimeout(r, ${ms}));`;

function orchestrate(
	data: Record<string, unknown>,
	branches: Record<string, string | ReturnType<typeof block>>,
) {
	return compileGraph(
		[
			block("entry", BlockTypes.entrypoint),
			block("orch", BlockTypes.orchestrator, data),
			...Object.entries(branches).map(([id, value]) =>
				typeof value === "string" ? block(id, BlockTypes.jsrunner, { value }) : value,
			),
			block("res", BlockTypes.response, { httpCode: "200" }),
		],
		[
			edge("entry", "orch"),
			...Object.keys(branches).map((id) => edge("orch", id, "orchestrate")),
			edge("orch", "res"),
		],
	);
}

describe("orchestrator", () => {
	it("runs branches at the same time and orders outputs by `order`", async () => {
		const { run } = orchestrate(
			{ order: ["b", "a"] },
			{
				a: `${sleep(60)} return "a" + input;`,
				b: `${sleep(60)} return "b" + input;`,
			},
		);
		const started = performance.now();
		const result = await run(createContext(), 1);
		expect(performance.now() - started).toBeLessThan(110);
		expect(result.output.body).toEqual(["b1", "a1"]);
	});

	it("puts unlisted branches after the ordered ones", async () => {
		const { run } = orchestrate(
			{ order: ["c"] },
			{ a: `return "a";`, b: `return "b";`, c: `return "c";` },
		);
		expect((await run(createContext(), null)).output.body).toEqual(["c", "a", "b"]);
	});

	it("fails the block when a branch throws, by default", async () => {
		const { run } = orchestrate({}, { a: `throw new Error("boom");`, b: `return 1;` });
		expect((await run(createContext(), null)).successful).toBe(false);
	});

	it("settle keeps the error in the failed branch's slot", async () => {
		const { run } = orchestrate(
			{ onError: "settle" },
			{ a: `throw new Error("boom");`, b: `return 1;` },
		);
		expect((await run(createContext(), null)).output.body).toEqual(["Error: boom", 1]);
	});

	it("ends the route with the first response a branch reaches", async () => {
		const { run } = orchestrate(
			{},
			{
				fast: block("fast", BlockTypes.response, { httpCode: "201" }),
				slow: `${sleep(30)} return 1;`,
			},
		);
		expect((await run(createContext(), "x")).output).toEqual({ httpCode: "201", body: "x" });
	});

	it("saves the array to outputs when asked", async () => {
		const { run } = orchestrate(
			{ saveAsVariable: { enabled: true, name: "all" } },
			{ a: `return 1;` },
		);
		const ctx = createContext();
		await run(ctx, null);
		expect(ctx.vars.outputs.all).toEqual([1]);
	});
});
