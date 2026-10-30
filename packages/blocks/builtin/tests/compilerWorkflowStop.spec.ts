import { describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import { createDbAdapter } from "./dbHarness";
import { block, collectSpans, createContext, edge } from "./compilerTestHelpers";

const CHECK = "throwIfAborted";

/** a JS block that logs `name` through the test's `step`, which may stop the run */
const step = (id: string, name = id) =>
	block(id, BlockTypes.jsrunner, { value: `await step(${JSON.stringify(name)}); return input;` });

/** runs a workflow graph: `stopAt` aborts the signal when that step is reached, then the step's I/O fails like an aborted call */
async function run(
	blocks: BlockDTOType[],
	edges: EdgeDTOSchemaType,
	stopAt?: string,
	extra: Record<string, unknown> = {},
) {
	const controller = new AbortController();
	const log: string[] = [];
	const ctx = {
		...createContext(),
		signal: controller.signal,
		...extra,
	};
	ctx.vars.step = async (name: string) => {
		log.push(name);
		if (name !== stopAt) return;
		controller.abort();
		throw new Error("aborted I/O");
	};
	const compiled = compileGraph(blocks, edges, { asWorkflow: true });
	const outcome = await compiled.run(ctx, [1, 2]).then(
		(result) => ({ result }),
		(error) => ({ rejected: error }),
	);
	return { ...outcome, log, signal: controller.signal, ctx } as {
		result?: any;
		rejected?: unknown;
		log: string[];
		signal: AbortSignal;
		ctx: any;
	};
}

const entry = block("in", BlockTypes.entrypoint);
const handler = [block("eh", BlockTypes.errorHandler), step("handled")];
const handlerEdges = [edge("eh", "handled")];

/** every construct a stop has to get out of, for the route baseline */
const everything = {
	blocks: [
		entry,
		block("for", BlockTypes.forloop, { start: 0, end: 2 }),
		step("forBody"),
		block("each", BlockTypes.foreachloop, { values: [1], useParam: false }),
		step("eachBody"),
		block("retry", BlockTypes.retry, { maxRetries: 1 }),
		step("retryBody"),
		block("tx", BlockTypes.db_transaction, { connection: "db", executor: "txBody" }),
		step("txBody"),
		block("fan", BlockTypes.orchestrator),
		step("branch"),
		...handler,
	],
	edges: [
		edge("in", "for"),
		edge("for", "forBody", "executor"),
		edge("for", "each"),
		edge("each", "eachBody", "executor"),
		edge("each", "retry"),
		edge("retry", "retryBody", "executor"),
		edge("retry", "tx", "success"),
		edge("tx", "txBody", "executor"),
		edge("tx", "fan", "success"),
		edge("fan", "branch", "orchestrate"),
		...handlerEdges,
	],
};

describe("what a stop check emits", () => {
	it("leaves a route's compiled source byte-identical", () => {
		const { source } = compileGraph(everything.blocks, everything.edges);
		expect(source).toMatchSnapshot();
	});

	it("leaves a custom block's compiled source byte-identical", () => {
		const { source } = compileGraph(everything.blocks, everything.edges, { asCustomBlock: true });
		expect(source).toMatchSnapshot();
	});

	it("checks at the entry of every block of a workflow", () => {
		const { source } = compileGraph(everything.blocks, everything.edges, { asWorkflow: true });
		const blocks = source.match(/function \$block_\d+\(/g)!.length;
		expect(source.split(CHECK).length - 1).toBe(blocks);
	});
});

describe("a stop during an I/O block", () => {
	const blocks = [entry, step("work"), step("after"), ...handler];
	const edges = [edge("in", "work"), edge("work", "after"), ...handlerEdges];

	it("ends the run without the next block or the error handler", async () => {
		const { result, log, rejected } = await run(blocks, edges, "work");
		expect(log).toEqual(["work"]);
		expect(rejected).toBeUndefined();
		expect(result.successful).toBe(false);
	});

	it("ends the run when a stop arrives during the error handler", async () => {
		const failing = block("work", BlockTypes.jsrunner, { value: `throw new Error("boom");` });
		const { log, rejected } = await run(
			[entry, failing, block("eh", BlockTypes.errorHandler), step("handled"), step("cleanup")],
			[edge("in", "work"), edge("eh", "handled"), edge("handled", "cleanup")],
			"handled",
		);
		expect(log).toEqual(["handled"]);
		// the job treats this as a stop: its signal has aborted
		expect(rejected).toBeDefined();
	});

	it("keeps the spans recorded up to the stop, and none for blocks that never ran", async () => {
		const { spans, trace } = collectSpans();
		await run([entry, step("first"), ...blocks.slice(1)], [edge("in", "first"), edge("first", "work"), ...edges.slice(1)], "work", {
			trace,
		});
		expect(spans.map((span) => [span.blockId, span.outcome])).toEqual([
			["in", "success"],
			["first", "success"],
			["work", "failure"],
		]);
	});
});

describe("a stop mid-loop", () => {
	const after = step("after");

	it("ends a for loop at the next iteration", async () => {
		const { log } = await run(
			[entry, block("loop", BlockTypes.forloop, { start: 0, end: 5 }), step("body"), after, ...handler],
			[edge("in", "loop"), edge("loop", "body", "executor"), edge("loop", "after"), ...handlerEdges],
			"body",
		);
		expect(log).toEqual(["body"]);
	});

	it("ends a for each loop at the next iteration, even when the body swallowed the abort", async () => {
		const swallow = block("body", BlockTypes.jsrunner, {
			value: `try { await step("body"); } catch {} return input;`,
		});
		const { log, result } = await run(
			[entry, block("loop", BlockTypes.foreachloop, { useParam: true, values: [] }), swallow, after, ...handler],
			[edge("in", "loop"), edge("loop", "body", "executor"), edge("loop", "after"), ...handlerEdges],
			"body",
		);
		expect(log).toEqual(["body"]);
		expect(result.successful).toBe(false);
	});

	it("leaves every level of a nested loop", async () => {
		const swallow = block("inner", BlockTypes.jsrunner, {
			value: `try { await step("inner"); } catch {} return input;`,
		});
		const { log } = await run(
			[
				entry,
				block("outer", BlockTypes.forloop, { start: 0, end: 3 }),
				block("nested", BlockTypes.forloop, { start: 0, end: 3 }),
				swallow,
				after,
				...handler,
			],
			[
				edge("in", "outer"),
				edge("outer", "nested", "executor"),
				edge("nested", "inner", "executor"),
				edge("outer", "after"),
				...handlerEdges,
			],
			"inner",
		);
		expect(log).toEqual(["inner"]);
	});
});

describe("a stop inside a block with a chain of its own", () => {
	const loopIn = (owner: BlockDTOType, handle = "executor") => ({
		blocks: [
			entry,
			owner,
			block("loop", BlockTypes.forloop, { start: 0, end: 3 }),
			step("body"),
			step("after"),
			...handler,
		],
		edges: [
			edge("in", owner.id),
			edge(owner.id, "loop", handle),
			edge("loop", "body", "executor"),
			...handlerEdges,
		],
	});

	it("retry neither tries again nor waits", async () => {
		const { blocks, edges } = loopIn(
			block("retry", BlockTypes.retry, { maxRetries: 5, delayMs: 30_000 }),
		);
		const startedAt = Date.now();
		const { log } = await run(
			blocks,
			[...edges, edge("retry", "after", "success"), edge("retry", "after", "failure")],
			"body",
		);
		expect(log).toEqual(["body"]);
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});

	it("a transaction rolls back rather than commits, and its failure branch does not run", async () => {
		const db = createDbAdapter();
		const { blocks, edges } = loopIn(
			block("tx", BlockTypes.db_transaction, { connection: "db", executor: "loop" }),
		);
		const { log } = await run(
			blocks,
			[...edges, edge("tx", "after", "success"), edge("tx", "after", "failure")],
			"body",
			{ dbFactory: { getDbAdapter: () => db.adapter } },
		);
		expect(log).toEqual(["body"]);
		const called = db.calls.map((call) => call.method);
		expect(called).toContain("rollbackTransaction");
		expect(called).not.toContain("commitTransaction");
	});

	it("a settling orchestrator does not go on to the next block", async () => {
		const { blocks, edges } = loopIn(
			block("fan", BlockTypes.orchestrator, { onError: "settle" }),
			"orchestrate",
		);
		const { log } = await run(blocks, [...edges, edge("fan", "after")], "body");
		expect(log).toEqual(["body"]);
	});
});

describe("a workflow that is not stopped", () => {
	const graph = {
		blocks: [
			entry,
			block("loop", BlockTypes.forloop, { start: 0, end: 2 }),
			step("body"),
			step("after"),
			block("boom", BlockTypes.jsrunner, { value: `throw new Error("boom");` }),
			...handler,
		],
		edges: [
			edge("in", "loop"),
			edge("loop", "body", "executor"),
			edge("loop", "after"),
			edge("after", "boom"),
			...handlerEdges,
		],
	};

	it("runs to the end, error handler included, with a live signal", async () => {
		const { log } = await run(graph.blocks, graph.edges);
		expect(log).toEqual(["body", "body", "after", "handled"]);
	});

	it("runs to the end, error handler included, with no signal (no Run ID)", async () => {
		const { log } = await run(graph.blocks, graph.edges, undefined, { signal: undefined });
		expect(log).toEqual(["body", "body", "after", "handled"]);
	});
});
