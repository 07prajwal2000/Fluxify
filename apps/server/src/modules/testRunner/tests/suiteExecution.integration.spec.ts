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
		assertions: [],
		hooks: [],
		suite: { id: "s1", name: "Suite one" },
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

		const result = await runSuiteInChild(
			bootstrap(source, {
				assertions: [
					{ target: "header", propertyPath: "x-suite", operator: "eq", expectedValue: "ok" },
					{ target: "customJs", customJs: "t.expect(fluxify.response.body.who).toBe('world');" },
					{ target: "status", operator: "eq", expectedValue: "500" },
				],
			}),
		);

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
		// read these back
		expect(result.headers["x-suite"]).toBe("ok");
		// judged in the child, custom JS included
		expect(result.verdict.success).toBe(false);
		expect(result.verdict.result.map((r) => r.success)).toEqual([true, true, false]);
	}, 30_000);

	it("runs block hooks: a skipped block, a changed output and their t.expect lines", async () => {
		const { source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				// would need a real database: skipped by its hook
				block("2", BlockTypes.jsrunner, { value: "throw new Error('real DB call')" }),
				block("3", BlockTypes.jsrunner, { value: "return { ...input, seen: true };" }),
				block("4", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3"), edge("3", "4")] as any,
			{ hooks: true },
		);

		const result = await runSuiteInChild(
			bootstrap(source, {
				hooks: [
					{
						blockId: "2",
						blockType: "jsrunner",
						blockName: "Load user",
						onBefore: { kind: "json", value: '{"id":7}' },
						onAfter: null,
					},
					{
						blockId: "3",
						blockType: "jsrunner",
						blockName: "Mark",
						onBefore: null,
						onAfter: {
							kind: "script",
							value: `t.expect(input, "input").toEqual({ id: 7 });
								t.expect(t.call).toBe(2);
								return { ...output, patched: true };`,
						},
					},
				],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toEqual({ id: 7, seen: true, patched: true });
		expect(result.verdict.success).toBe(false);
		expect(result.verdict.result).toEqual([
			{ success: true, message: 'jsrunner "Mark": input: expected {"id":7} to equal {"id":7} ✓' },
			{ success: false, message: 'jsrunner "Mark": expected 1 to be 2' },
		]);
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

	describe("setup and teardown (#483)", () => {
		/** a test-only custom block whose whole graph is one JS runner */
		const customBlock = (name: string, code: string) => ({
			name,
			source: compileGraph(
				[block("1", BlockTypes.entrypoint), block("2", BlockTypes.jsrunner, { value: code })],
				[edge("1", "2")] as any,
				{ asCustomBlock: true },
			).source,
		});
		// teardown reports what it was told by failing with it
		const reportingTeardown = customBlock(
			"report",
			"throw new Error(testsuite.phase + ' ' + testsuite.outcome + ' ' + JSON.stringify(testsuite.setup));",
		);
		const route = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, { value: "return { ok: true };" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")] as any,
		).source;
		const phases = (setupCode: string, teardown = reportingTeardown) => ({
			customBlocks: [customBlock("seed", setupCode), teardown],
			setup: { block: "seed", timeoutMs: 5_000 },
			teardown: { block: teardown.name, timeoutMs: 5_000 },
		});

		it("runs setup, gives its output to assertions, then teardown with the outcome", async () => {
			const result = await runSuiteInChild(
				bootstrap(route, {
					...phases("return { userId: 7, phase: testsuite.phase, runId: testsuite.runId };"),
					assertions: [
						{ target: "customJs", customJs: "t.expect(t.setup).toEqual({ userId: 7, phase: 'setup', runId: 'run-1' });" },
					],
				}),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			// teardown failed, the suite still passed
			expect(result.verdict.success).toBe(true);
			expect(result.teardownError).toBe('teardown passed {"userId":7,"phase":"setup","runId":"run-1"}');
		}, 30_000);

		it("skips the route when setup fails, but still tears down", async () => {
			const result = await runSuiteInChild(
				bootstrap(route, phases("throw new Error('no seed');")),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toBe("Setup failed: no seed");
			expect(result.teardownError).toBe("teardown error undefined");
		}, 30_000);

		it("kills a hung route, then tears down in a fresh child with the setup output", async () => {
			const result = await runSuiteInChild(
				bootstrap("await new Promise(() => {});", {
					...phases("return { userId: 9 };"),
					timeoutMs: 1_000,
				}),
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.timedOut).toBe(true);
			expect(result.teardownError).toBe('teardown timeout {"userId":9}');
		}, 30_000);

		it("keeps the route's result when teardown hangs", async () => {
			const result = await runSuiteInChild(
				bootstrap(route, {
					...phases("return 1;", customBlock("hang", "await new Promise(() => {});")),
					teardown: { block: "hang", timeoutMs: 1_000 },
				}),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(Number(result.status)).toBe(200);
			expect(result.teardownError).toBe("teardown timed out after 1000ms");
		}, 30_000);
	});
});
