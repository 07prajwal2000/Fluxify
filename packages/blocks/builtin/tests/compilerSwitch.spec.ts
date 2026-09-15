import { describe, expect, it } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import { FAN_OUT_HANDLES, getOutputHandles } from "../../blockHandles";
import type { BlockDTOType } from "../../builderTypes";
import { switchBlockSchema } from "../switch";
import { block, collectSpans, createContext, edge } from "./compilerTestHelpers";

type Case = { when?: string; run?: string | BlockDTOType };

/**
 * entry -> switch -> one block per case. A case's block defaults to a JS runner
 * returning the case id, so the route's output names the case that ran.
 */
function switchGraph(cases: Record<string, Case>, data: Record<string, unknown> = {}) {
	const conditions: Record<string, string> = {};
	for (const [id, c] of Object.entries(cases)) {
		// `when` is JS; stored conditions carry the editor's prefix
		if (c.when !== undefined) conditions[id] = c.when.startsWith("js:") ? c.when : `js:${c.when}`;
	}
	return compileGraph(
		[
			block("entry", BlockTypes.entrypoint),
			block("sw", BlockTypes.switch, { conditions, ...data }),
			...Object.entries(cases).map(([id, c]) =>
				typeof c.run === "object"
					? c.run
					: block(id, BlockTypes.jsrunner, { value: c.run ?? `return "${id}";` }),
			),
		],
		[edge("entry", "sw"), ...Object.keys(cases).map((id) => edge("sw", id, "case"))],
	);
}

async function run(graph: ReturnType<typeof compileGraph>, input: unknown = null) {
	const ctx = createContext();
	const result = await graph.run(ctx, input);
	return { ...result, ctx };
}

describe("switch block: picking a case", () => {
	it("runs the first case whose condition is truthy", async () => {
		const graph = switchGraph({
			a: { when: "return false;" },
			b: { when: "return true;" },
			c: { when: "return true;" },
		});
		expect((await run(graph)).output).toBe("b");
	});

	it("checks cases in `order`, so the order decides between two matches", async () => {
		const graph = switchGraph(
			{ a: { when: "return true;" }, b: { when: "return true;" }, c: { when: "return true;" } },
			{ order: ["c", "b", "a"] },
		);
		expect((await run(graph)).output).toBe("c");
	});

	it("checks unlisted cases after the listed ones, in connection order", async () => {
		const graph = switchGraph(
			{ a: { when: "return true;" }, b: { when: "return true;" }, c: { when: "return false;" } },
			{ order: ["c"] },
		);
		expect((await run(graph)).output).toBe("a");
	});

	it("ignores ids in `order` that are no longer connected", async () => {
		const graph = switchGraph(
			{ a: { when: "return true;" }, b: { when: "return true;" } },
			{ order: ["gone", "b"] },
		);
		expect((await run(graph)).output).toBe("b");
	});

	it("lets conditions read the switch's input", async () => {
		const graph = switchGraph({
			small: { when: "return input.n < 10;" },
			big: { when: "return input.n >= 10;" },
		});
		expect((await run(graph, { n: 5 })).output).toBe("small");
		expect((await run(graph, { n: 50 })).output).toBe("big");
	});

	it("hands the switch's input to the case that runs", async () => {
		const graph = switchGraph({
			double: { when: "return typeof input.n === 'number';", run: "return input.n * 2;" },
		});
		expect((await run(graph, { n: 21 })).output).toBe(42);
	});

	it("never evaluates the conditions below the first match", async () => {
		const graph = switchGraph({
			a: { when: "return true;" },
			b: { when: "throw new Error('checked a condition after the match');" },
		});
		const result = await run(graph);
		expect(result.successful).toBe(true);
		expect(result.output).toBe("a");
	});

	it("never runs the blocks of cases that did not match", async () => {
		const graph = switchGraph({
			a: { when: "return false;", run: "throw new Error('case a ran');" },
			b: { when: "return true;" },
			c: { when: "return true;", run: "throw new Error('case c ran');" },
		});
		const result = await run(graph);
		expect(result.successful).toBe(true);
		expect(result.output).toBe("b");
	});

	it("awaits an async condition", async () => {
		const graph = switchGraph({
			a: { when: "return await Promise.resolve(false);" },
			b: { when: "return await new Promise((r) => setTimeout(() => r(true), 5));" },
		});
		expect((await run(graph)).output).toBe("b");
	});

	it("evaluates the same switch independently on every request", async () => {
		const graph = switchGraph({
			even: { when: "return input % 2 === 0;" },
			odd: { when: "return true;" },
		});
		const outputs = await Promise.all([1, 2, 3, 4].map(async (n) => (await run(graph, n)).output));
		expect(outputs).toEqual(["odd", "even", "odd", "even"]);
	});
});

describe("switch block: what counts as a match", () => {
	const cases: [string, boolean][] = [
		["return true;", true],
		["return 1;", true],
		['return "no";', true],
		["return {};", true],
		["return [];", true],
		["return -1;", true],
		["return false;", false],
		["return 0;", false],
		['return "";', false],
		["return null;", false],
		["return undefined;", false],
		["return NaN;", false],
	];
	for (const [when, matches] of cases) {
		it(`${when} ${matches ? "matches" : "does not match"}`, async () => {
			const graph = switchGraph({ hit: { when } });
			const result = await run(graph, "untouched");
			expect(result.output).toBe(matches ? "hit" : "untouched");
		});
	}

	it("a bare expression without `return` never matches", async () => {
		const graph = switchGraph({ bare: { when: "input === 'x'" }, fallback: { when: "return true;" } });
		expect((await run(graph, "x")).output).toBe("fallback");
	});

	it("a missing, empty or blank condition never matches", async () => {
		const graph = switchGraph({
			missing: {},
			empty: { when: "" },
			blank: { when: "   \n\t" },
			hit: { when: "return true;" },
		});
		expect((await run(graph)).output).toBe("hit");
	});

	it("accepts a condition stored with the editor's js: prefix", async () => {
		const graph = switchGraph({
			prefixed: { when: "js: return input === 'go';" },
			fallback: { when: "return true;" },
		});
		expect((await run(graph, "go")).output).toBe("prefixed");
		expect((await run(graph, "stop")).output).toBe("fallback");
	});

	it("a js: prefix with no code never matches", async () => {
		const graph = switchGraph({ empty: { when: "js:  " }, hit: { when: "return true;" } });
		expect((await run(graph)).output).toBe("hit");
	});

	it("a `return true;` case placed last acts as the default", async () => {
		const graph = switchGraph(
			{
				fallback: { when: "return true;" },
				paid: { when: "return input.status === 'paid';" },
			},
			{ order: ["paid", "fallback"] },
		);
		expect((await run(graph, { status: "paid" })).output).toBe("paid");
		expect((await run(graph, { status: "pending" })).output).toBe("fallback");
	});
});

describe("switch block: when nothing runs", () => {
	it("ends the route with the switch's input when no case matches", async () => {
		const graph = switchGraph({
			a: { when: "return false;", run: "throw new Error('case a ran');" },
			b: { when: "return 0;", run: "throw new Error('case b ran');" },
		});
		const result = await run(graph, { keep: "me" });
		expect(result.successful).toBe(true);
		expect(result.output).toEqual({ keep: "me" });
	});

	it("ends the route with its input when no case is connected", async () => {
		const graph = compileGraph(
			[block("entry", BlockTypes.entrypoint), block("sw", BlockTypes.switch)],
			[edge("entry", "sw")],
		);
		expect((await run(graph, 7)).output).toBe(7);
	});

	it("ignores conditions for blocks that are not connected", async () => {
		const graph = switchGraph({ a: { when: "return false;" } }, {
			conditions: { a: "false", ghost: "true" },
		});
		expect((await run(graph, "in")).output).toBe("in");
	});
});

describe("switch block: failures", () => {
	it("fails the route when a condition throws, without running any case", async () => {
		const graph = switchGraph({
			a: { when: "throw new Error('bad condition');", run: "throw new Error('case a ran');" },
			b: { when: "return true;", run: "throw new Error('case b ran');" },
		});
		const result = await run(graph);
		expect(result.successful).toBe(false);
		expect(String(result.error)).toContain("bad condition");
	});

	it("hands a throwing condition to the error handler", async () => {
		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("sw", BlockTypes.switch, { conditions: { a: "js: throw new Error('bad');" } }),
				block("a", BlockTypes.jsrunner, { value: "return 'a';" }),
				block("err", BlockTypes.errorHandler),
				block("recover", BlockTypes.jsrunner, { value: "return 'recovered: ' + input;" }),
			],
			[edge("entry", "sw"), edge("sw", "a", "case"), edge("err", "recover")],
		);
		const result = await run(graph);
		// the recovery flow ran, but the route still reports the failure
		expect(result.successful).toBe(false);
		expect(result.error).toBe("recovered: Error: bad");
	});

	it("fails the route when the matched case's block throws", async () => {
		const graph = switchGraph({ a: { when: "return true;", run: "throw new Error('case broke');" } });
		expect((await run(graph)).successful).toBe(false);
	});

	it("compiles several edges on the case handle without the multi-edge error", () => {
		expect(() =>
			switchGraph({ a: { when: "return 1;" }, b: { when: "return 1;" }, c: { when: "return 1;" } }),
		).not.toThrow();
	});
});

describe("switch block: inside a larger flow", () => {
	it("follows a case's chain past its first block", async () => {
		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("sw", BlockTypes.switch, { conditions: { step: "true" } }),
				block("step", BlockTypes.jsrunner, { value: "return input + 1;" }),
				block("res", BlockTypes.response, { httpCode: "201" }),
			],
			[edge("entry", "sw"), edge("sw", "step", "case"), edge("step", "res")],
		);
		expect((await run(graph, 1)).output).toEqual({ httpCode: "201", body: 2 });
	});

	it("ends the route with a response connected straight to a case", async () => {
		const graph = switchGraph({
			notFound: {
				when: "return input == null;",
				run: block("notFound", BlockTypes.response, { httpCode: "404" }),
			},
			found: { when: "return true;", run: block("found", BlockTypes.response, { httpCode: "200" }) },
		});
		expect((await run(graph, null)).output).toEqual({ httpCode: "404", body: null });
		expect((await run(graph, "user")).output).toEqual({ httpCode: "200", body: "user" });
	});

	it("receives the output of the block before it", async () => {
		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("prep", BlockTypes.jsrunner, { value: "return { role: input };" }),
				block("sw", BlockTypes.switch, { conditions: { admin: "js: return input.role === 'admin';" } }),
				block("admin", BlockTypes.jsrunner, { value: "return 'welcome ' + input.role;" }),
			],
			[edge("entry", "prep"), edge("prep", "sw"), edge("sw", "admin", "case")],
		);
		expect((await run(graph, "admin")).output).toBe("welcome admin");
	});

	it("nests: a case can lead into another switch", async () => {
		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("outer", BlockTypes.switch, {
					order: ["inner", "other"],
					conditions: { inner: "js: return input.kind === 'a';", other: "true" },
				}),
				block("inner", BlockTypes.switch, {
					conditions: { small: "js: return input.n < 10;", large: "true" },
				}),
				block("small", BlockTypes.jsrunner, { value: "return 'a-small';" }),
				block("large", BlockTypes.jsrunner, { value: "return 'a-large';" }),
				block("other", BlockTypes.jsrunner, { value: "return 'other';" }),
			],
			[
				edge("entry", "outer"),
				edge("outer", "inner", "case"),
				edge("outer", "other", "case"),
				edge("inner", "small", "case"),
				edge("inner", "large", "case"),
			],
		);
		expect((await run(graph, { kind: "a", n: 1 })).output).toBe("a-small");
		expect((await run(graph, { kind: "a", n: 99 })).output).toBe("a-large");
		expect((await run(graph, { kind: "b", n: 1 })).output).toBe("other");
	});

	it("works as a branch inside an orchestrator", async () => {
		const graph = compileGraph(
			[
				block("entry", BlockTypes.entrypoint),
				block("orch", BlockTypes.orchestrator, { order: ["sw", "plain"] }),
				block("sw", BlockTypes.switch, { conditions: { yes: "js: return input > 0;" } }),
				block("yes", BlockTypes.jsrunner, { value: "return 'positive';" }),
				block("plain", BlockTypes.jsrunner, { value: "return 'plain';" }),
				block("res", BlockTypes.response, { httpCode: "200" }),
			],
			[
				edge("entry", "orch"),
				edge("orch", "sw", "orchestrate"),
				edge("orch", "plain", "orchestrate"),
				edge("sw", "yes", "case"),
				edge("orch", "res"),
			],
		);
		expect((await run(graph, 5)).output.body).toEqual(["positive", "plain"]);
		// no match: the switch branch ends with its own input
		expect((await run(graph, -5)).output.body).toEqual([-5, "plain"]);
	});
});

describe("switch block: tracing", () => {
	async function traced(graph: ReturnType<typeof compileGraph>, input: unknown) {
		const { spans, trace } = collectSpans();
		const ctx = createContext();
		ctx.trace = trace;
		const result = await graph.run(ctx, input);
		return { spans, result };
	}

	it("records one span for the switch and one for the case that ran", async () => {
		const graph = switchGraph({ a: { when: "return false;" }, b: { when: "return true;" } });
		const { spans } = await traced(graph, "in");
		const switchSpans = spans.filter((span) => span.blockId === "sw");
		expect(switchSpans).toHaveLength(1);
		expect(switchSpans[0]).toMatchObject({
			blockType: BlockTypes.switch,
			input: "in",
			output: "in",
			outcome: "success",
		});
		expect(spans.map((span) => span.blockId)).toEqual(["entry", "sw", "b"]);
	});

	it("records the switch span when no case matches", async () => {
		const graph = switchGraph({ a: { when: "return false;" } });
		const { spans } = await traced(graph, 3);
		expect(spans.map((span) => span.blockId)).toEqual(["entry", "sw"]);
		expect(spans[1]).toMatchObject({ outcome: "success", output: 3 });
	});

	it("records a throwing condition as the switch block's failure", async () => {
		const graph = switchGraph({ a: { when: "throw new Error('bad');" } });
		const { spans, result } = await traced(graph, null);
		expect(result.successful).toBe(false);
		const failures = spans.filter((span) => span.outcome === "failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]?.blockId).toBe("sw");
		expect(failures[0]?.error).toBeInstanceOf(Error);
	});

	it("attributes a failing case block's error to that block, not the switch", async () => {
		const graph = switchGraph({ a: { when: "return true;", run: "throw new Error('case broke');" } });
		const { spans } = await traced(graph, null);
		const failures = spans.filter((span) => span.outcome === "failure");
		expect(failures.map((span) => span.blockId)).toEqual(["a"]);
	});
});

describe("switch block: schema and handles", () => {
	it("defaults to conditions mode with nothing configured", () => {
		expect(switchBlockSchema.parse({})).toMatchObject({
			order: [],
			conditions: {},
			useValue: false,
			value: "",
			matches: {},
		});
	});

	it("rejects a non-boolean toggle and non-text case values", () => {
		expect(switchBlockSchema.safeParse({ useValue: "yes" }).success).toBe(false);
		expect(switchBlockSchema.safeParse({ matches: { a: 404 } }).success).toBe(false);
		expect(switchBlockSchema.safeParse({ value: 1 }).success).toBe(false);
	});

	it("rejects conditions that are not text and an order that is not a list", () => {
		expect(switchBlockSchema.safeParse({ conditions: { a: 1 } }).success).toBe(false);
		expect(switchBlockSchema.safeParse({ conditions: ["return true;"] }).success).toBe(false);
		expect(switchBlockSchema.safeParse({ order: "a" }).success).toBe(false);
		expect(switchBlockSchema.safeParse({ order: [1] }).success).toBe(false);
	});

	it("exposes only a fan-out 'case' output handle", () => {
		expect(getOutputHandles(BlockTypes.switch)).toEqual(["case"]);
		expect(FAN_OUT_HANDLES).toContain("case");
	});
});
