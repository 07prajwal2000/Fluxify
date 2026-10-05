import { afterAll, describe, expect, it } from "bun:test";
import { type BlockDTOType, BlockTypes, compileGraph } from "@fluxify/blocks";
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

	it("fails the request when a named middleware is not loaded, never skips it", async () => {
		applyArtifactUpdate(`middleware.${PROJECT}.mw-auth`, null);
		await expect(runBlocks(target, context(1))).rejects.toThrow("Middleware not loaded: mw-auth");
	});
});
