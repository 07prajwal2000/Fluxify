import { describe, expect, it } from "bun:test";
import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { runSuiteInChild } from "../spawn";
import type { SuiteInputSpec, TestBootstrap } from "../types";

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

	describe("workflow suites (#487)", () => {
		// doubles `n`; n = 13 makes the workflow throw
		const workflow = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, {
					value: `if (input.n === 13) throw new Error("unlucky");
						return { doubled: input.n * 2, source: trigger.source, events: trigger.data.length };`,
				}),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")] as any,
			{ asWorkflow: true, hooks: true },
		).source;

		const workflowBoot = (input: SuiteInputSpec, extra: Partial<TestBootstrap> = {}) =>
			({
				...bootstrap(workflow),
				route: undefined,
				request: undefined,
				workflow: { id: "w1", name: "double" },
				input,
				assertions: [
					{ target: "successful", operator: "true" },
					{
						target: "customJs",
						customJs: "t.expect(fluxify.result.output.doubled).toBe(fluxify.input.n * 2);",
					},
				],
				...extra,
			}) as TestBootstrap;

		it("runs every case with the same checks and keeps going after a failure", async () => {
			const result = await runSuiteInChild(
				workflowBoot({
					mode: "cases",
					raw: [{ name: "one", input: { n: 1 } }, { input: { n: 13 } }, { n: 4 }],
				}),
			);
			expect(result.ok).toBe(true);
			if (!result.ok || !result.cases) throw new Error("expected workflow cases");
			expect(result.cases.map((c) => [c.name, c.status])).toEqual([
				["one", "passed"],
				["Case 2", "failed"],
				["Case 3", "passed"],
			]);
			expect(result.counts).toMatchObject({ total: 3, passed: 2, failed: 1 });
			expect(result.cases[0]!.output).toEqual({
				successful: true,
				output: { doubled: 2, source: "internal", events: 1 },
			});
			expect(result.cases[1]!.error).toContain("unlucky");
			expect(result.verdict.success).toBe(false);
		}, 30_000);

		it("sends a single input as one run, even when it is a list", async () => {
			const result = await runSuiteInChild(
				workflowBoot(
					{ mode: "single", raw: [1, 2] },
					{
						assertions: [
							{
								target: "customJs",
								// a list is a bulk batch: one event per item, `input` the whole list
								customJs: "t.expect(fluxify.result.output.events).toBe(2);",
							},
						],
					},
				),
			);
			if (!result.ok || !result.cases) throw new Error("expected workflow cases");
			expect(result.cases).toHaveLength(1);
			expect(result.cases[0]!.status).toBe("passed");
		}, 30_000);

		it("reads cases from an input script compiled like a JS block", async () => {
			const script = compileGraph(
				[
					block("entry", BlockTypes.entrypoint),
					block("script", BlockTypes.jsrunner, {
						value: "return [1, 2, 3].map((n) => ({ name: `n=${n}`, input: { n } }));",
					}),
				],
				[edge("entry", "script")] as any,
				{ asCustomBlock: true },
			).source;
			const result = await runSuiteInChild(
				workflowBoot(
					{ mode: "cases", block: { block: "input_script", timeoutMs: 5_000 } },
					{ customBlocks: [{ name: "input_script", source: script }] },
				),
			);
			if (!result.ok || !result.cases) throw new Error("expected workflow cases");
			expect(result.cases.map((c) => c.name)).toEqual(["n=1", "n=2", "n=3"]);
			expect(result.counts.passed).toBe(3);
		}, 30_000);

		it("errors the suite when a cases input is not a list", async () => {
			const result = await runSuiteInChild(workflowBoot({ mode: "cases", raw: { n: 1 } }));
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error).toContain("must be a list");
		}, 30_000);

		it("sends a one-item list as one event with the bare value as input", async () => {
			const result = await runSuiteInChild(workflowBoot({ mode: "single", raw: [{ n: 3 }] }));
			if (!result.ok || !result.cases) throw new Error("expected workflow cases");
			expect(result.cases[0]!.output).toEqual({
				successful: true,
				output: { doubled: 6, source: "internal", events: 1 },
			});
		}, 30_000);

		it("runs a list of lists as cases, each a bulk run of its items", async () => {
			const result = await runSuiteInChild(
				workflowBoot(
					{
						mode: "cases",
						raw: [
							[{ n: 1 }, { n: 2 }],
							[{ n: 3 }, { n: 4 }, { n: 5 }],
						],
					},
					{
						assertions: [
							{
								target: "customJs",
								customJs:
									"t.expect(fluxify.result.output.events).toBe(fluxify.input.length);",
							},
						],
					},
				),
			);
			if (!result.ok || !result.cases) throw new Error("expected workflow cases");
			expect(result.cases.map((c) => [c.name, c.status])).toEqual([
				["Case 1", "passed"],
				["Case 2", "passed"],
			]);
		}, 30_000);
	});
});
