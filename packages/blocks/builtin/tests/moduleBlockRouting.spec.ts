import { afterEach, describe, expect, it } from "bun:test";
import type { HandleSpec } from "../../blockHandles";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import {
	type BlockMeta,
	customBlockNames,
	type ModuleBlockRun,
	registerCustomBlock,
	registerModuleBlock,
	unregisterBlock,
} from "../customBlock";

const PROJECT = "proj-r3";
const TYPE = "acme/demo/step";

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string, handle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-${handle}`,
});
const ctx = () =>
	({
		route: "/r3",
		apiId: "api-1",
		projectId: PROJECT,
		vars: {},
		stopper: { timeoutEnd: 0, duration: 10000 },
	}) as any;

const spec = (out: HandleSpec["out"]): HandleSpec => ({ in: ["target"], out, body: [] });
const respond = (id: string) => block(id, BlockTypes.response, { httpCode: "200" });
/** a response whose status says which branch reached it */
const tagged = (id: string, httpCode: string) => block(id, BlockTypes.response, { httpCode });
const reply = async (run: (c: any, i: any) => Promise<any>) => {
	const { output } = await run(ctx(), {});
	return { [output.httpCode]: output.body };
};

function setup(out: HandleSpec["out"], run: ModuleBlockRun, meta: Partial<BlockMeta> = {}) {
	const blockMeta = { handles: spec(out), ...meta };
	registerModuleBlock(PROJECT, TYPE, run, blockMeta);
	return { [TYPE]: blockMeta };
}

const compile = (
	blocks: BlockDTOType[],
	edges: ReturnType<typeof edge>[],
	blockMeta: Record<string, BlockMeta>,
) => compileGraph(blocks, edges, { projectId: PROJECT, blockMeta });

/** entry -> step -> success/failure responses (only the edges in `wired`) */
function branched(blockMeta: Record<string, BlockMeta>, wired = ["success", "failure"]) {
	return compile(
		[block("1", BlockTypes.entrypoint), block("2", TYPE), tagged("3", "200"), tagged("4", "400")],
		[
			edge("1", "2"),
			...wired.map((h) => (h === "success" ? edge("2", "3", h) : edge("2", "4", h))),
		],
		blockMeta,
	);
}

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
});

describe("module block handle routing", () => {
	it("[source] hands its output to the next block", async () => {
		const meta = setup(["source"], ({ input }) => ({ output: `got ${input}` }));
		const { run, source } = compile(
			[block("1", BlockTypes.entrypoint), block("2", TYPE), respond("3")],
			[edge("1", "2"), edge("2", "3")],
			meta,
		);
		expect(source).toContain("lib.invokeRouted(");
		expect((await run(ctx(), "x")).output.body).toBe("got x");
	});

	it("[success, failure] takes success for a returned success or no handle", async () => {
		for (const handle of ["success", undefined]) {
			const meta = setup(["success", "failure"], () => ({ output: 1, handle }));
			expect(await reply(branched(meta).run)).toEqual({ 200: 1 });
		}
	});

	it("[success, failure] takes failure with the output on a returned failure", async () => {
		const meta = setup(["success", "failure"], () => ({ output: "nope", handle: "failure" }));
		expect(await reply(branched(meta).run)).toEqual({ 400: "nope" });
	});

	it("a throw goes to the failure edge with the error", async () => {
		const meta = setup(["success", "failure"], () => {
			throw new Error("boom");
		});
		expect(await reply(branched(meta).run)).toEqual({ 400: "boom" });
	});

	it("a throw without a failure edge fails the run", async () => {
		const meta = setup(["success", "failure"], () => {
			throw new Error("boom");
		});
		const result = await branched(meta, ["success"]).run(ctx(), {});
		expect(result.successful).toBe(false);
		expect(String(result.error)).toContain("boom");
	});

	it("an unknown returned handle fails the run, naming the block and handle", async () => {
		const meta = setup(["success", "failure"], () => ({ handle: "maybe" }));
		const result = await branched(meta).run(ctx(), {});
		expect(result.successful).toBe(false);
		expect(String(result.error)).toContain(`Block ${TYPE} returned unknown handle 'maybe'`);
	});

	it("[] ends the run after the block", async () => {
		const meta = setup([], () => ({ output: "done" }));
		const { run } = compile(
			[block("1", BlockTypes.entrypoint), block("2", TYPE)],
			[edge("1", "2")],
			meta,
		);
		expect(await run(ctx(), {})).toMatchObject({ successful: true, output: "done" });
	});
});

describe("module block invoke modes", () => {
	const calling = (invoke: string, blockMeta: Record<string, BlockMeta>) =>
		compile(
			[block("1", BlockTypes.entrypoint), block("2", TYPE, { invoke }), respond("3")],
			[edge("1", "2"), edge("2", "3")],
			blockMeta,
		);

	it("rejects a mode the block does not allow", () => {
		const meta = { [TYPE]: { handles: spec(["source"]), invoke: ["sync" as const] } };
		expect(() => calling("queued", meta)).toThrow(
			`Block 2 (${TYPE}) cannot be invoked queued; allowed: sync`,
		);
	});

	it("rejects async and queued on a [success, failure] block", () => {
		const meta = { [TYPE]: { handles: spec(["success", "failure"]) } };
		for (const mode of ["async", "queued"])
			expect(() => calling(mode, meta)).toThrow(`must be invoked sync, not ${mode}`);
	});

	it("async on a [source] block fires and continues", async () => {
		const meta = setup(["source"], () => ({ output: "ignored" }));
		const { run, source } = calling("async", meta);
		expect(source).toContain("lib.invokeAsync(");
		expect((await run(ctx(), "mine")).output.body).toBe("mine");
	});
});

describe("canvas custom blocks are unchanged", () => {
	it("still emit lib.invoke into the flowing variable", () => {
		registerCustomBlock(
			PROJECT,
			"canvas-step",
			[block("a", BlockTypes.entrypoint), respond("b")],
			[edge("a", "b")],
		);
		const { source } = compile(
			[block("1", BlockTypes.entrypoint), block("2", "canvas-step", { x: 1 }), respond("3")],
			[edge("1", "2"), edge("2", "3")],
			{},
		);
		expect(source).toContain(
			'$in = await lib.invoke(ctx, "canvas-step", { params: { "x": 1 }, input: $in }, "2");',
		);
		expect(source).not.toContain("invokeRouted");
	});

	it("still pass a param named order, which only module blocks reserve", async () => {
		registerCustomBlock(
			PROJECT,
			"canvas-order",
			[block("a", BlockTypes.entrypoint), block("b", BlockTypes.jsrunner, { value: "return params.order" }), block("c", BlockTypes.response, { httpCode: "200" })],
			[edge("a", "b"), edge("b", "c")],
		);
		const { run } = compile(
			[block("1", BlockTypes.entrypoint), block("2", "canvas-order", { order: ["x"] }), respond("3")],
			[edge("1", "2"), edge("2", "3")],
			{},
		);
		expect((await run(ctx(), {})).output.body).toMatchObject({ body: ["x"] });
	});
});
