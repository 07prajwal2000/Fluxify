import { afterEach, describe, expect, it } from "bun:test";
import type { HandleSpec } from "../../blockHandles";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import {
	type BlockMeta,
	customBlockNames,
	type ModuleBlockRun,
	registerModuleBlock,
	unregisterBlock,
} from "../customBlock";
import { collectSpans } from "./compilerTestHelpers";

const PROJECT = "proj-r4";

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string, handle = "source") => ({
	id: `e-${from}-${to}-${handle}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});
const ctx = (extra: object = {}) =>
	({
		route: "/r4",
		apiId: "api-1",
		projectId: PROJECT,
		vars: {},
		stopper: { timeoutEnd: 0, duration: 10000 },
		...extra,
	}) as any;
const js = (id: string, value: string, data: object = {}) =>
	block(id, BlockTypes.jsrunner, { value, ...data });
const respond = (id: string) => block(id, BlockTypes.response, { httpCode: "200" });

const metas: Record<string, BlockMeta> = {};
function register(type: string, body: HandleSpec["body"], run: ModuleBlockRun, invoke?: any) {
	const meta: BlockMeta = { handles: { in: ["target"], out: ["source"], body }, invoke };
	registerModuleBlock(PROJECT, type, run, meta);
	metas[type] = meta;
}
const compile = (blocks: BlockDTOType[], edges: ReturnType<typeof edge>[]) =>
	compileGraph(blocks, edges, { projectId: PROJECT, blockMeta: metas });

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
	for (const type of Object.keys(metas)) delete metas[type];
});

const LOOP = "acme/demo/loop";
const executor = [{ name: "executor", corner: "bottom-left" as const }];

/** entry -> LOOP -> response, LOOP's executor -> `body` (first id is the chain's start) */
function looped(run: ModuleBlockRun, body: BlockDTOType[] = [], bodyEdges = []) {
	register(LOOP, executor, run);
	return compile(
		[block("1", BlockTypes.entrypoint), block("2", LOOP), respond("3"), ...body],
		[
			edge("1", "2"),
			edge("2", "3"),
			...(body[0] ? [edge("2", body[0].id, "executor")] : []),
			...bodyEdges,
		],
	);
}
const body = async (run: (c: any, i: any) => Promise<any>, input?: unknown) => {
	const result = await run(ctx(), input);
	if (!result.successful) throw result.error;
	return result.output.body;
};

describe("executeHandle: one body chain", () => {
	it("resolves to the value the chain ended with", async () => {
		const { run } = looped(
			async ({ input, executeHandle }) => ({ output: await executeHandle!("executor", input) }),
			[js("4", "return input * 2"), js("5", "return input + 1")],
			[edge("4", "5")] as any,
		);
		expect(await body(run, 5)).toBe(11);
	});

	it("resolves undefined when nothing is wired to the handle", async () => {
		const { run } = looped(async ({ executeHandle }) => ({
			output: { value: await executeHandle!("executor", 1) },
		}));
		expect(await body(run)).toEqual({ value: undefined });
	});

	it("runs the chain once per call, each from its own input", async () => {
		const { run } = looped(
			async ({ executeHandle }) => ({
				output: [await executeHandle!("executor", 1), await executeHandle!("executor", 2)],
			}),
			[js("4", "return input * 10")],
		);
		expect(await body(run)).toEqual([10, 20]);
	});

	it("rejects an unknown or non-body handle, naming the block type", async () => {
		for (const handle of ["nope", "source"]) {
			const { run } = looped(async ({ executeHandle }) => ({
				output: await executeHandle!(handle),
			}));
			const result = await run(ctx(), 1);
			expect(result.successful).toBe(false);
			expect(String(result.error)).toContain(
				`Block ${LOOP} has no body handle '${handle}'; body handles: executor`,
			);
		}
	});
});

const AGENT = "acme/ai/agent";
const tools = [{ name: "tools", corner: "bottom-left" as const, allowMultiple: true }];

/** entry -> AGENT -> response; AGENT's tools fan out to the given chains */
function fanned(run: ModuleBlockRun, branches: BlockDTOType[], order?: string[]) {
	register(AGENT, tools, run);
	return compile(
		[block("1", BlockTypes.entrypoint), block("2", AGENT, { order }), respond("3"), ...branches],
		[edge("1", "2"), edge("2", "3"), ...branches.map((b) => edge("2", b.id, "tools"))],
	);
}

describe("executeHandle: allowMultiple", () => {
	const three = [
		js("a", "return `a:${input}`", { blockName: "Search" }),
		js("b", "return `b:${input}`"),
		js("c", "return `c:${input}`"),
	];

	it("runs every branch in canvas order and resolves to their results", async () => {
		const { run } = fanned(
			async ({ input, executeHandle }) => ({ output: await executeHandle!("tools", input) }),
			three,
			["c", "a"],
		);
		expect(await body(run, 1)).toEqual(["c:1", "a:1", "b:1"]);
	});

	it("keeps the canvas branch order out of the block's params", async () => {
		const { run } = fanned(async ({ params }) => ({ output: params }), three, ["c"]);
		expect(await body(run)).toEqual({});
	});

	it("puts a failing branch's error in its slot and finishes the others", async () => {
		const { run } = fanned(
			async ({ executeHandle }) => {
				const [ok, failed] = (await executeHandle!("tools", 1)) as any[];
				return { output: { ok, failed: String(failed.error) } };
			},
			[js("a", "return input + 1"), js("b", "throw new Error('tool broke')")],
		);
		expect(await body(run)).toEqual({ ok: 2, failed: "Error: tool broke" });
	});

	it("runs one branch by id or by label, and lists the branches", async () => {
		const { run } = fanned(
			async ({ executeHandle }) => ({
				output: {
					byId: await executeHandle!("tools", 1, { branch: "b" }),
					byLabel: await executeHandle!("tools", 2, { branch: "Search" }),
					branches: executeHandle!.branches("tools"),
				},
			}),
			three,
		);
		expect(await body(run)).toEqual({
			byId: "b:1",
			byLabel: "a:2",
			branches: [
				{ id: "a", label: "Search" },
				{ id: "b", label: BlockTypes.jsrunner },
				{ id: "c", label: BlockTypes.jsrunner },
			],
		});
	});
});

const TOOL = "acme/ai/tool";
const execute = [{ name: "execute", corner: "bottom-left" as const }];
/** returns `{ call }` over its execute chain, the §9.6 tool */
const tool: ModuleBlockRun = ({ executeHandle }) => ({
	output: { call: (args: unknown) => executeHandle!("execute", args) },
});

describe("executeHandle after run returned", () => {
	it("serves a later block's call and records its spans under the owning block", async () => {
		register(TOOL, execute, tool, ["sync"]);
		register("acme/ai/caller", [], async ({ input }) => ({ output: await input.call(4) }));
		const { run } = compile(
			[
				block("1", BlockTypes.entrypoint),
				block("2", TOOL),
				block("3", "acme/ai/caller"),
				respond("4"),
				js("5", "return input * 3"),
			],
			[edge("1", "2"), edge("2", "3"), edge("3", "4"), edge("2", "5", "execute")],
		);
		const { spans, trace } = collectSpans();
		const result = await run(ctx({ trace }), {});
		expect(result.output.body).toBe(12);
		expect(spans.find((s) => s.blockId === "5")).toMatchObject({ owner: "2", output: 12 });
		expect(spans.find((s) => s.blockId === "3")?.owner).toBeUndefined();
	});

	it("serves the agent's tools: a body chain that ends in a tool block", async () => {
		register(TOOL, execute, tool, ["sync"]);
		register(AGENT, tools, async ({ executeHandle }) => {
			const found = (await executeHandle!("tools")) as { call(a: unknown): Promise<unknown> }[];
			return { output: await Promise.all(found.map((t) => t.call(2))) };
		});
		const { run } = compile(
			[
				block("1", BlockTypes.entrypoint),
				block("2", AGENT),
				respond("3"),
				block("t1", TOOL),
				block("t2", TOOL),
				js("x1", "return input + 1"),
				js("x2", "return input * 5"),
			],
			[
				edge("1", "2"),
				edge("2", "3"),
				edge("2", "t1", "tools"),
				edge("2", "t2", "tools"),
				edge("t1", "x1", "execute"),
				edge("t2", "x2", "execute"),
			],
		);
		expect(await body(run)).toEqual([3, 10]);
	});

	it("throws once the outermost run has ended", async () => {
		register(TOOL, execute, tool, ["sync"]);
		const { run } = compile(
			[block("1", BlockTypes.entrypoint), block("2", TOOL), respond("3"), js("4", "return 1")],
			[edge("1", "2"), edge("2", "3"), edge("2", "4", "execute")],
		);
		const { call } = await body(run);
		await expect(call(1)).rejects.toThrow("executeHandle('execute') called after the run ended");
	});
});

describe("executeHandle compile checks", () => {
	it("rejects a terminal block reachable from a body handle", () => {
		expect(() =>
			looped(async () => ({}), [js("4", "return 1"), respond("5")], [edge("4", "5")] as any),
		).toThrow(
			`Block 5 (response) is terminal, so it cannot be in the chain on body handle 'executor' of block 2 (${LOOP})`,
		);
	});

	it("allows a rollback inside a transaction the chain opens", () => {
		expect(() =>
			looped(
				async () => ({}),
				[
					block("4", BlockTypes.db_transaction, { connection: "db", executor: "5" }),
					block("5", BlockTypes.db_rollback),
				],
				[edge("4", "5", "executor")] as any,
			),
		).not.toThrow();
	});

	it("rejects async on a block with a wired body handle", () => {
		register(LOOP, executor, async () => ({}));
		expect(() =>
			compile(
				[block("1", BlockTypes.entrypoint), block("2", LOOP, { invoke: "async" }), js("4", "1")],
				[edge("1", "2"), edge("2", "4", "executor")],
			),
		).toThrow(`Block 2 (${LOOP}) has wired body handles, so it must be invoked sync, not async`);
	});
});
