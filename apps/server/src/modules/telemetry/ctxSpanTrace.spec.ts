import { afterEach, describe, expect, it } from "bun:test";
import {
	BlockTypes,
	type BlockDTOType,
	compileGraph,
	customBlockNames,
	registerModuleBlock,
	unregisterBlock,
} from "@fluxify/blocks";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { RouteTraceRecorder } from "./routeRecorder";

const PROJECT = "proj-r5";
const TOOL = "acme/ai/tool";
const block = (id: string, type: string, data: object = {}): BlockDTOType => ({
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

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
});

/** entry -> TOOL (execute -> js "double") -> response; TOOL wraps its chain call in ctx.span */
async function recordRun() {
	const meta = { handles: { in: ["target"], out: ["source"], body: [{ name: "execute", corner: "bottom-left" }] } };
	registerModuleBlock(
		PROJECT,
		TOOL,
		async ({ ctx, executeHandle }) => ({
			output: await ctx.span!("outer", async () => {
				await ctx.span!("inner", () => 1);
				return executeHandle!("execute", 4);
			}),
		}),
		meta as any,
	);
	const { run } = compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", TOOL),
			block("3", BlockTypes.response, { httpCode: "200" }),
			block("4", BlockTypes.jsrunner, { value: "return input * 2" }),
		],
		[edge("1", "2"), edge("2", "3"), edge("2", "4", "execute")],
		{ projectId: PROJECT, blockMeta: { [TOOL]: meta as any }, tracing: true } as any,
	);
	const runs: TraceRunPayload[] = [];
	const recorder = new RouteTraceRecorder(
		{ projectId: PROJECT, routeId: "r", routeVersion: "v", method: "GET", path: "/t" },
		(payload) => runs.push(payload),
	);
	const ctx = {
		route: "/t",
		apiId: "a",
		projectId: PROJECT,
		vars: {},
		trace: recorder,
	} as any;
	const result = await run(ctx, {});
	recorder.complete("success", 200);
	return { result, payload: runs[0] };
}

describe("ctx.span through the recorder", () => {
	it("persists owner and parent", async () => {
		const { result, payload } = await recordRun();
		expect(result.output.body).toBe(8);
		const named = (name: string) => payload.spans.find((s) => s.blockName === name)!;
		const tool = payload.spans.find((s) => s.blockId === "2")!;

		// outer hangs off the block through the trace it was entered with; inner names outer
		expect(named("outer")).toMatchObject({ blockType: "span", parentSeq: tool.seq });
		expect(named("inner").metadata?.parent).toBe(named("outer").blockId);
		expect(named("outer").metadata?.parent).toBeUndefined();
		// the chain's span names the block that ran it, and stays on the block's canvas level
		const chain = payload.spans.find((s) => s.blockId === "4")!;
		expect(chain.metadata?.owner).toBe("2");
		expect(chain.parentSeq).toBeUndefined();

	});
});

describe("late spans", () => {
	it("counts spans recorded after completion and warns once per run", async () => {
		// the logger is a proxy, so read what it prints
		const printed: string[] = [];
		const write = process.stdout.write;
		process.stdout.write = ((chunk: string) => {
			printed.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		try {
			const recorder = new RouteTraceRecorder(
				{ projectId: "p", routeId: "r", routeVersion: "v", method: "GET", path: "/" },
				() => {},
			);
			recorder.complete("success");
			const late = { blockId: "x", blockType: "js", input: 1, output: 2, startedAt: 1, endedAt: 2 };
			for (let i = 0; i < 3; i++) recorder.recordSpan({ ...late, outcome: "success" });
			await new Promise((resolve) => setTimeout(resolve, 400));
		} finally {
			process.stdout.write = write;
		}
		const warned = printed.filter((line) => line.includes("recorded after the trace completed"));
		expect(warned).toHaveLength(1);
		expect(warned[0]).toContain("3 span(s)");
	});
});
