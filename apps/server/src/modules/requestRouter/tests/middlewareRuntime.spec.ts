import { afterAll, describe, expect, it } from "bun:test";
import { type BlockDTOType, BlockTypes, compileGraph } from "@fluxify/blocks";
import type { TraceRunPayload } from "@fluxify/common/otlp";
import { RouteTraceRecorder } from "../../telemetry/routeRecorder";
import {
	applyArtifactUpdate,
	initCompiledRuntime,
	shutdownCompiledRuntime,
} from "../compiledRuntime";
import { runBlocks } from "../executor";

const PROJECT = "proj-mw";
const target = { projectId: PROJECT, routeId: "route-mw", projectName: PROJECT };

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});

/** a custom block artifact whose graph runs `js` on its input */
function customBlock(name: string, js: string) {
	const blocks = [
		block(`${name}-entry`, BlockTypes.entrypoint),
		block(`${name}-js`, BlockTypes.jsrunner, { value: js }),
	];
	const { source } = compileGraph(blocks, [edge(`${name}-entry`, `${name}-js`)], {
		asCustomBlock: true,
	});
	return {
		key: `custom-block.${PROJECT}.${name}`,
		value: { id: name, name, projectId: PROJECT, source, compiledAt: "" },
	};
}

const middleware = (id: string, name: string, blocks: string[]) => ({
	key: `middleware.${PROJECT}.${id}`,
	value: { id, name, blocks, projectId: PROJECT, compiledAt: "" },
});

const route = {
	key: `route.${PROJECT}.${target.routeId}`,
	value: {
		routeId: target.routeId,
		projectId: PROJECT,
		projectName: PROJECT,
		method: "GET",
		path: "/mw",
		timeoutSeconds: 30,
		acceptedContentTypes: [],
		tracingEnabled: true,
		recordExecution: false,
		routeVersion: "",
		compiledAt: "",
		// the route names its middlewares by id only (#579)
		middlewares: { before: ["mw-auth"], after: ["mw-tag"] },
		source: compileGraph(
			[
				block("r-entry", BlockTypes.entrypoint),
				block("r-js", BlockTypes.jsrunner, { value: "return input;" }),
				block("r-res", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("r-entry", "r-js"), edge("r-js", "r-res")],
		).source,
	},
};

const context = (input: unknown) =>
	({
		route: "/mw",
		projectId: PROJECT,
		apiId: "api-1",
		vars: {},
		requestBody: input,
		stopper: { timeoutEnd: 0, duration: 10_000 },
	}) as any;

initCompiledRuntime([
	customBlock("add_one", "return input + 1;"),
	customBlock("double", "return input * 2;"),
	customBlock("tag", "return { ...input, body: input.body + '!' };"),
	middleware("mw-auth", "Auth", ["add_one", "double"]),
	middleware("mw-tag", "Tag", ["tag"]),
	route,
]);

afterAll(() => shutdownCompiledRuntime());

describe("route middlewares from their own artifacts", () => {
	it("runs the chains the route names by id", async () => {
		const result = await runBlocks(target, context(1));
		expect(result?.output).toEqual({ httpCode: 200, body: { httpCode: 200, body: "4!" } });
	});

	it("picks up a renamed, re-chained middleware without a new route artifact", async () => {
		const renamed = middleware("mw-auth", "Auth v2", ["double"]);
		applyArtifactUpdate(renamed.key, renamed.value);

		const result = await runBlocks(target, context(1));

		expect(result?.output.body).toEqual({ httpCode: 200, body: "2!" });
		const original = middleware("mw-auth", "Auth", ["add_one", "double"]);
		applyArtifactUpdate(original.key, original.value);
	});

	it("nests each middleware's blocks under a labelled middleware span", async () => {
		const runs: TraceRunPayload[] = [];
		const trace = new RouteTraceRecorder(
			{ projectId: PROJECT, routeId: target.routeId, routeVersion: "", method: "GET", path: "/mw" },
			(run) => runs.push(run),
		);
		const ctx = context(1);
		ctx.trace = trace;

		await runBlocks(target, ctx);
		trace.complete("success", 200);

		const spans = runs[0]!.spans;
		const by = (blockId: string) => spans.find((s) => s.blockId === blockId)!;
		const auth = by("middleware:mw-auth");
		expect(auth).toMatchObject({
			blockType: "middleware",
			blockName: "Auth",
			middleware: { id: "mw-auth", name: "Auth", phase: "before", position: 0, blocks: ["add_one", "double"] },
			input: 1,
			output: 4,
			outcome: "success",
		});
		expect(auth.parentSeq).toBeUndefined();
		// middleware -> custom block -> that block's own blocks
		const step = by("middleware:mw-auth:double");
		expect(step).toMatchObject({ blockType: "double", parentSeq: auth.seq, input: 2, output: 4 });
		expect(by("double-js").parentSeq).toBe(step.seq);
		expect(by("middleware:mw-tag")).toMatchObject({ middleware: { phase: "after", position: 0 } });
		// the route's own blocks stay at the top
		expect(by("r-js").parentSeq).toBeUndefined();
	});

	it("fails the request when a named middleware is not loaded, never skips it", async () => {
		applyArtifactUpdate(`middleware.${PROJECT}.mw-auth`, null);
		await expect(runBlocks(target, context(1))).rejects.toThrow("Middleware not loaded: mw-auth");
	});
});
