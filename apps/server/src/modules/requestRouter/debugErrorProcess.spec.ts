import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BlockTypes, compileGraph } from "@fluxify/blocks";
import {
	DEBUG_ERROR_HEADER,
	DEBUG_TOKEN_HEADER,
	decodeDebugError,
	routeDebugKey,
	signDebugToken,
} from "./debugError";
import { DEBUG_TRACE_HEADER, decodeDebugTrace } from "./debugTrace";
import { createExecutionSupervisor } from "./executionSupervisor";

/**
 * The real execution process, end to end (#671): only a token the admin signed
 * for the route turns the debug error on. Any public request gets the generic body.
 */
const P = "0192b1c4-3333-7000-8000-000000000001";
const key = routeDebugKey(Buffer.alloc(32, 7).toString("base64"));
const port = 20_000 + Math.floor(Math.random() * 20_000);

const block = (id: string, type: BlockTypes, data: any = {}) => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});

function route(id: string, path: string, failing: ReturnType<typeof block>, traced = false) {
	const { source } = compileGraph(
		[block("entry", BlockTypes.entrypoint), failing],
		[edge("entry", failing.id)],
		{ tracing: traced },
	);
	return {
		key: `route.${P}.${id}`,
		value: {
			routeId: id,
			projectId: P,
			projectName: "p",
			method: "GET",
			path,
			timeoutSeconds: 10,
			acceptedContentTypes: [],
			tracingEnabled: traced,
			recordExecution: false,
			routeVersion: "1",
			source,
		},
	};
}

const artifacts = [
	{
		key: `project-config.${P}.current`,
		value: {
			projectId: P,
			compiledAt: new Date().toISOString(),
			payload: {
				appConfig: {},
				// nothing listens on port 1: the driver fails, the block hides why
				dbIntegrations: {
					db1: { dbType: "pg", source: "url", url: "postgres://u:p@127.0.0.1:1/app" },
				},
				kvIntegrations: {},
				observabilityIntegrations: {},
				aiIntegrations: {},
				projectSettings: {},
			},
		},
	},
	route(
		"r-db",
		"/users",
		block("load", BlockTypes.db_native, {
			blockName: "Load users",
			connection: "db1",
			js: "return await dbQuery('SELECT emial FROM users');",
		}),
	),
	route(
		"r-js",
		"/js",
		block("calc", BlockTypes.jsrunner, {
			blockName: "Calc",
			value: "function total(x) { return x.items.length; }\nreturn total(undefined);",
		}),
	),
	route(
		"r-trace",
		"/traced",
		block("calc", BlockTypes.jsrunner, { blockName: "Calc", value: "return { n: 41 + 1 };" }),
		true,
	),
	route(
		"r-trace-fail",
		"/traced-fail",
		block("boom", BlockTypes.jsrunner, { value: "throw new Error('nope');" }),
		true,
	),
];

const supervisor = createExecutionSupervisor({
	projectId: P,
	port,
	entry: new URL("./executionProcess.ts", import.meta.url),
	databaseIdleTimeoutMs: 1_000,
	asyncExecutor: { maxInFlight: 1, maxQueueDepth: 1, drainTimeoutMs: 1_000 },
	maxRequestBodyBytes: 1_024 * 1_024,
	scheduleHorizonMs: 1_000,
	logging: { level: "error", otlpEndpoint: "", otlpHeaders: {}, useOtlp: false },
	artifacts: () => artifacts,
	trustedOrigins: [],
	debugKey: key,
	baseDomain: () => "",
	timeoutsEnabled: () => false,
});

const call = (path: string, headers: Record<string, string> = {}) =>
	fetch(`http://127.0.0.1:${port}${path}`, { headers });
const signed = (id: string) => ({ [DEBUG_TOKEN_HEADER]: signDebugToken(key, { projectId: P, id }) });

beforeAll(async () => {
	supervisor.start();
	for (let attempt = 0; attempt < 200; attempt++) {
		const res = await call("/js").catch(() => null);
		if (res && res.status !== 503) return;
		await Bun.sleep(50);
	}
	throw new Error("execution process never served");
}, 20_000);

afterAll(async () => {
	supervisor.stop();
	const child = supervisor.child();
	child?.kill();
	await child?.exited;
});

describe("debug errors through the execution process", () => {
	it("gives the admin call the block and the driver error behind the generic message", async () => {
		const res = await call("/users", signed("r-db"));
		expect(res.status).toBe(500);
		expect(await res.text()).toContain("failed to execute native db block");
		const debug = decodeDebugError(res.headers.get(DEBUG_ERROR_HEADER));
		expect(debug).toMatchObject({
			block: { id: "load", type: "db_native", name: "Load users" },
			message: "failed to execute native db block",
		});
		expect(debug?.detail).toBeString();
		expect(debug?.detail).not.toContain("failed to execute");
		// a driver error is not the user's code: no stack, no server paths
		expect(debug?.stack).toBeUndefined();
	});

	it("gives a public caller only the generic answer, forged header or not", async () => {
		const plain = await call("/users");
		const forged = await call("/users", { [DEBUG_TOKEN_HEADER]: `${Date.now() + 30_000}.forged` });
		const otherRoute = await call("/users", signed("r-js"));
		for (const res of [plain, forged, otherRoute]) {
			expect(res.status).toBe(500);
			expect(res.headers.get(DEBUG_ERROR_HEADER)).toBeNull();
			expect(await res.text()).not.toContain("127.0.0.1");
		}
	});

	it("shows only the user's own frames for an error in their code", async () => {
		const res = await call("/js", signed("r-js"));
		const debug = decodeDebugError(res.headers.get(DEBUG_ERROR_HEADER));
		expect(debug?.block).toEqual({ id: "calc", type: "jsrunner", name: "Calc" });
		expect(debug?.message).toContain("items");
		expect(debug?.stack).toContain("at total (fluxify-graph:");
		expect(debug?.stack).not.toMatch(/[\\/]|\.ts:|\$block|\$run/);
	});
});

describe("debug trace through the execution process", () => {
	it("gives the admin call the blocks that ran, in order", async () => {
		const res = await call("/traced", signed("r-trace"));
		expect(res.status).toBe(200);
		const trace = decodeDebugTrace(res.headers.get(DEBUG_TRACE_HEADER));
		expect(trace?.spans.map((s) => [s.blockId, s.blockType, s.outcome])).toEqual([
			["entry", "entrypoint", "success"],
			["calc", "jsrunner", "success"],
		]);
		expect(trace?.spans[1]).toMatchObject({ blockName: "Calc", output: '{"n":42}' });
	});

	it("marks the block that failed", async () => {
		const res = await call("/traced-fail", signed("r-trace-fail"));
		expect(res.status).toBe(500);
		const trace = decodeDebugTrace(res.headers.get(DEBUG_TRACE_HEADER));
		expect(trace?.spans.at(-1)).toMatchObject({ blockId: "boom", outcome: "failure" });
		expect(trace?.spans.at(-1)?.error).toContain("nope");
	});

	it("gives a public caller no trace, forged header or not", async () => {
		const forged = { [DEBUG_TOKEN_HEADER]: `${Date.now() + 30_000}.forged` };
		for (const res of [await call("/traced"), await call("/traced", forged)]) {
			expect(res.status).toBe(200);
			expect(res.headers.get(DEBUG_TRACE_HEADER)).toBeNull();
		}
	});

	it("sends none for a route with tracing off", async () => {
		const res = await call("/js", signed("r-js"));
		expect(res.headers.get(DEBUG_TRACE_HEADER)).toBeNull();
	});
});
