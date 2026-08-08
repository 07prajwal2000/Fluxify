import { describe, expect, it } from "bun:test";
import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { runSuiteInChild } from "../spawn";
import type { TestBootstrap } from "../types";

/**
 * The real thing: a graph compiled the way the compiler compiles it, run in a
 * spawned child that has no database, no NATS and no artifact store — only the
 * bootstrap. An in-process assertion cannot catch a payload that will not cross
 * the process boundary, or a loader that only works when the cache was warm.
 */
const block = (id: string, type: string, data: any = {}) => ({
	id,
	type,
	position: { x: 0, y: 0 },
	data,
});
const edge = (from: string, to: string) => ({
	id: `${from}-${to}`,
	from,
	to,
	// "source" is the default handle the compiler follows; anything else is a
	// conditional branch and the graph reads as unconnected
	fromHandle: "source",
	toHandle: "source",
});

function bootstrap(source: string, overrides: Partial<TestBootstrap> = {}) {
	return {
		suiteRunId: "run-1",
		projectId: "p1",
		route: { id: "r1", projectName: "demo" },
		source,
		customBlocks: [],
		config: {
			appConfig: { GREETING: "hello" },
			dbIntegrations: {},
			kvIntegrations: {},
			observabilityIntegrations: {},
			aiIntegrations: {},
			projectSettings: {},
		},
		request: {
			method: "GET",
			path: "/demo",
			headers: { "x-caller": "suite" },
			query: { who: "world" },
			params: {},
			body: null,
		},
		timeoutMs: 10_000,
		...overrides,
	} satisfies TestBootstrap;
}

describe("runSuiteInChild", () => {
	it("runs a compiled route and returns its response, config and headers", async () => {
		const { source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, {
					value: `setHeader("x-suite", "ok");
						return { greeting: getConfig("GREETING"), who: getQueryParam("who"), caller: getHeader("x-caller") };`,
				}),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")] as any,
		);

		const result = await runSuiteInChild(bootstrap(source));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Number(result.status)).toBe(200);
		expect(result.data).toEqual({
			// proves the bootstrap config hydrated the loader cache in a cold process
			greeting: "hello",
			who: "world",
			caller: "suite",
		});
		// the route's header writes are captured, not dropped — header assertions
		// in the parent read these back
		expect(result.headers["x-suite"]).toBe("ok");
	}, 30_000);

	it("kills a route that never returns and reports it as a timeout", async () => {
		// hand-written compiled source: a graph cannot express "never return", and
		// this is the shape instantiateCompiled runs either way
		const result = await runSuiteInChild(
			bootstrap("await new Promise(() => {});", { timeoutMs: 1_000 }),
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.timedOut).toBe(true);
		expect(result.durationMs).toBeGreaterThanOrEqual(1_000);
	}, 30_000);

	it("reports a route that throws without taking the parent down", async () => {
		const result = await runSuiteInChild(
			bootstrap(`throw new Error("boom");`),
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("boom");
		expect(result.timedOut).toBeUndefined();
	}, 30_000);
});
