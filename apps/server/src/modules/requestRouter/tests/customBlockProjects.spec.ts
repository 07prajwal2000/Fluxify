import { afterAll, describe, expect, it } from "bun:test";
import { type BlockDTOType, BlockTypes, compileGraph } from "@fluxify/blocks";
import {
	applyArtifactUpdate,
	initCompiledRuntime,
	shutdownCompiledRuntime,
} from "../compiledRuntime";
import { runBlocks } from "../executor";

/**
 * Two projects on one `*` worker, each with a custom block called `greeting`.
 * The worker's library is shared, so the name alone cannot pick the block.
 */
const A = "proj-greet-a";
const B = "proj-greet-b";

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
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

/** a `greeting` custom block artifact of one project, answering `answer` */
function greeting(projectId: string, answer: string) {
	const { source } = compileGraph(
		[
			block("g-entry", BlockTypes.entrypoint),
			block("g-js", BlockTypes.jsrunner, { value: `return '${answer}';` }),
		],
		[edge("g-entry", "g-js")],
		{ asCustomBlock: true, projectId },
	);
	const id = `greeting-${projectId}`;
	return {
		key: `custom-block.${projectId}.${id}`,
		value: { id, name: "greeting", projectId, source, compiledAt: "" },
	};
}

/** the same route graph in each project: it calls `greeting` and replies with it */
function route(projectId: string) {
	const { source } = compileGraph(
		[
			block("r-entry", BlockTypes.entrypoint),
			block("r-call", "greeting", { invoke: "sync" }),
			block("r-res", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("r-entry", "r-call"), edge("r-call", "r-res")],
		{ projectId },
	);
	return {
		key: `route.${projectId}.route-greet`,
		value: {
			routeId: "route-greet",
			projectId,
			projectName: projectId,
			method: "GET",
			path: "/greet",
			timeoutSeconds: 30,
			acceptedContentTypes: [],
			tracingEnabled: false,
			recordExecution: false,
			routeVersion: "",
			compiledAt: "",
			source,
		},
	};
}

const call = (projectId: string) =>
	runBlocks(
		{ projectId, routeId: "route-greet", projectName: projectId },
		{
			route: "/greet",
			projectId,
			apiId: "api-1",
			vars: {},
			requestBody: null,
			stopper: { timeoutEnd: 0, duration: 10_000 },
		} as any,
	);

// the blocks are in the library before any route compiles, as on the compiler
initCompiledRuntime([greeting(A, "from-a"), greeting(B, "from-b")]);
for (const artifact of [route(A), route(B)]) applyArtifactUpdate(artifact.key, artifact.value);

afterAll(() => shutdownCompiledRuntime());

describe("custom blocks of two projects on one worker", () => {
	it("serves each route its own project's block", async () => {
		expect((await call(A))?.output.body).toBe("from-a");
		expect((await call(B))?.output.body).toBe("from-b");
	});

	it("replaces one project's block without touching the other's", async () => {
		const updated = greeting(A, "from-a-v2");
		applyArtifactUpdate(updated.key, updated.value);

		expect((await call(A))?.output.body).toBe("from-a-v2");
		expect((await call(B))?.output.body).toBe("from-b");
	});

	it("removes only the project's own block", async () => {
		applyArtifactUpdate(greeting(A, "").key, null);

		expect((await call(B))?.output.body).toBe("from-b");
		const gone = await call(A);
		expect(gone?.successful).toBe(false);
	});
});
