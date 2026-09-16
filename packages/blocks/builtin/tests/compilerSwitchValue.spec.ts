import { describe, expect, it } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { block, collectSpans, createContext, edge } from "./compilerTestHelpers";

/** entry -> switch in value mode -> one runner per case returning its id */
function valueSwitch(value: string, matches: Record<string, string>, data: Record<string, unknown> = {}) {
	const ids = Object.keys(matches);
	return compileGraph(
		[
			block("entry", BlockTypes.entrypoint),
			block("sw", BlockTypes.switch, { useValue: true, value, matches, ...data }),
			...ids.map((id) => block(id, BlockTypes.jsrunner, { value: `return "${id}";` })),
		],
		[edge("entry", "sw"), ...ids.map((id) => edge("sw", id, "case"))],
	);
}

const run = (graph: ReturnType<typeof compileGraph>, input: unknown = null) =>
	graph.run(createContext(), input);

describe("switch block: switching on a value", () => {
	it("runs the case whose value equals the script's result", async () => {
		const graph = valueSwitch("return input.status;", { paid: "paid", refunded: "refunded" });
		expect((await run(graph, { status: "paid" })).output).toBe("paid");
		expect((await run(graph, { status: "refunded" })).output).toBe("refunded");
	});

	it("runs the first matching case when two share a value", async () => {
		const graph = valueSwitch("return 'x';", { a: "x", b: "x" }, { order: ["b", "a"] });
		expect((await run(graph)).output).toBe("b");
	});

	it("ends the route with the switch's input when no value matches", async () => {
		const graph = valueSwitch("return input.status;", { paid: "paid" });
		expect((await run(graph, { status: "lost" })).output).toEqual({ status: "lost" });
	});

	it("types plain numbers and booleans, and compares strictly", async () => {
		const text = valueSwitch("return input.code;", { notFound: "404" });
		expect((await run(text, { code: 404 })).output).toBe("notFound");
		expect((await run(text, { code: "404" })).output).toEqual({ code: "404" });

		const flag = valueSwitch("return input.v;", { yes: "true" });
		expect((await run(flag, { v: true })).output).toBe("yes");
		expect((await run(flag, { v: "true" })).output).toEqual({ v: "true" });

		const number = valueSwitch("return input.code;", { notFound: "js: return 404;" });
		expect((await run(number, { code: 404 })).output).toBe("notFound");
		expect((await run(number, { code: "404" })).output).toEqual({ code: "404" });
	});

	it("lets a js: case value read the input", async () => {
		const graph = valueSwitch("return input.a;", { same: "js: return input.b;" });
		expect((await run(graph, { a: 3, b: 3 })).output).toBe("same");
		expect((await run(graph, { a: 3, b: 4 })).output).toEqual({ a: 3, b: 4 });
	});

	it("matches booleans, null and undefined through js: values", async () => {
		const graph = valueSwitch("return input.v;", {
			yes: "js: return true;",
			nothing: "js: return null;",
			missing: "js: return undefined;",
		});
		expect((await run(graph, { v: true })).output).toBe("yes");
		expect((await run(graph, { v: null })).output).toBe("nothing");
		expect((await run(graph, {})).output).toBe("missing");
	});

	it("accepts a value script stored with the js: prefix", async () => {
		const graph = valueSwitch("js: return input.kind;", { a: "a" });
		expect((await run(graph, { kind: "a" })).output).toBe("a");
	});

	it("awaits an async value script", async () => {
		const graph = valueSwitch("return await Promise.resolve(input);", { a: "a" });
		expect((await run(graph, "a")).output).toBe("a");
	});

	it("awaits an async js: match value before comparing", async () => {
		const graph = valueSwitch("return input.code;", {
			slow: "js: return await new Promise((r) => setTimeout(() => r(404), 5));",
			promise: "js: return Promise.resolve(500);",
		});
		expect((await run(graph, { code: 404 })).output).toBe("slow");
		expect((await run(graph, { code: 500 })).output).toBe("promise");
		expect((await run(graph, { code: 200 })).output).toEqual({ code: 200 });
	});

	it("gives the case the switch's input, not the computed value", async () => {
		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("sw", BlockTypes.switch, {
					useValue: true,
					value: "return input.kind;",
					matches: { echo: "a" },
				}),
				block("echo", BlockTypes.jsrunner, { value: "return input;" }),
			],
			[edge("entry", "sw"), edge("sw", "echo", "case")],
		);
		expect((await run(graph, { kind: "a", id: 1 })).output).toEqual({ kind: "a", id: 1 });
	});

	it("never picks a case with a missing, empty or blank value", async () => {
		const graph = valueSwitch("return '';", { empty: "", blank: "   ", jsEmpty: "js:" });
		expect((await run(graph, "in")).output).toBe("in");
	});

	it("ignores conditions in value mode, and matches in conditions mode", async () => {
		const valueMode = valueSwitch("return 'no';", { a: "yes" }, { conditions: { a: "return true;" } });
		expect((await run(valueMode, "in")).output).toBe("in");

		const conditionMode = valueSwitch("return 'yes';", { a: "yes" }, {
			useValue: false,
			conditions: { a: "false" },
		});
		expect((await run(conditionMode, "in")).output).toBe("in");
	});

	it("fails the route when the value script throws, without running any case", async () => {
		const graph = valueSwitch("throw new Error('no value');", { a: "js: return undefined;" });
		const result = await run(graph);
		expect(result.successful).toBe(false);
		expect(String(result.error)).toContain("no value");
	});

	it("still records one span for the switch", async () => {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		await valueSwitch("return input;", { a: "a" }).run(ctx, "a");
		expect(spans.map((span) => span.blockId)).toEqual(["entry", "sw", "a"]);
	});
});
