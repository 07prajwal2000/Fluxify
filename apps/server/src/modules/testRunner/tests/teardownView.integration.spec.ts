import { describe, expect, it } from "bun:test";
import { BlockTypes, compileGraph } from "@fluxify/blocks";
import { runSuiteInChild } from "../spawn";
import type { TestBootstrap } from "../types";

/**
 * Teardown gets what the suite sent and got back (#716), in a real child. The
 * teardown block reports it by failing with it, which surfaces as `teardownError`.
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
	fromHandle: "source",
	toHandle: "source",
});

const reporter = {
	name: "report",
	source: compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, {
				value:
					"throw new Error(JSON.stringify({ outcome: testsuite.outcome, request: testsuite.request, response: testsuite.response }));",
			}),
		],
		[edge("1", "2")] as any,
		{ asCustomBlock: true },
	).source,
};

const base = {
	suiteRunId: "run-1",
	testRunId: "test-run-1",
	projectId: "p1",
	customBlocks: [reporter],
	config: {
		appConfig: {},
		dbIntegrations: {},
		kvIntegrations: {},
		observabilityIntegrations: {},
		aiIntegrations: {},
		projectSettings: {},
	},
	timeoutMs: 10_000,
	assertions: [],
	hooks: [],
	suite: { id: "s1", name: "Suite one" },
	teardown: { block: "report", timeoutMs: 5_000 },
};

/** the object teardown saw */
async function seenByTeardown(boot: TestBootstrap) {
	const result = await runSuiteInChild(boot);
	expect(result.teardownError).toBeDefined();
	return JSON.parse(result.teardownError!);
}

describe("teardown request and response (#716)", () => {
	const routeBoot = (source: string, extra: Partial<TestBootstrap> = {}) =>
		({
			...base,
			source,
			route: { id: "r1", projectName: "demo" },
			request: {
				method: "POST",
				path: "/users",
				headers: { "x-caller": "suite" },
				query: {},
				params: {},
				body: { email: "a@test.local" },
			},
			...extra,
		}) as TestBootstrap;

	const route = (code: string, httpCode = "201") =>
		compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, { value: code }),
				block("3", BlockTypes.response, { httpCode }),
			],
			[edge("1", "2"), edge("2", "3")] as any,
		).source;

	it("hands a route's request and response to teardown", async () => {
		const seen = await seenByTeardown(routeBoot(route("setHeader('x-made', 'yes'); return { id: 31 };")));
		expect(seen.outcome).toBe("passed");
		expect(seen.request).toEqual({
			method: "POST",
			path: "/users",
			headers: { "x-caller": "suite" },
			query: {},
			params: {},
			body: { email: "a@test.local" },
		});
		expect(seen.response).toEqual({
			status: 201,
			headers: { "x-made": "yes" },
			body: { id: 31 },
		});
	}, 30_000);

	it("keeps an error response: the route answered", async () => {
		const seen = await seenByTeardown(routeBoot(route("return { message: 'nope' };", "409")));
		expect(seen.response).toMatchObject({ status: 409, body: { message: "nope" } });
	}, 30_000);

	it("has no response when the route timed out, but still the request", async () => {
		const seen = await seenByTeardown(
			routeBoot("await new Promise(() => {});", { timeoutMs: 1_000 }),
		);
		expect(seen.outcome).toBe("timeout");
		expect(seen.request.path).toBe("/users");
		expect(seen.response).toBeNull();
	}, 30_000);

	describe("workflow", () => {
		const workflow = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, {
					value: "if (input.n === 13) throw new Error('unlucky'); return { id: input.n * 2 };",
				}),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")] as any,
			{ asWorkflow: true, hooks: true },
		).source;
		const workflowBoot = (input: TestBootstrap["input"]) =>
			({
				...base,
				source: workflow,
				workflow: { id: "w1", name: "double" },
				input,
			}) as TestBootstrap;

		it("hands a single input and its output to teardown", async () => {
			const seen = await seenByTeardown(workflowBoot({ mode: "single", raw: { n: 4 } }));
			expect(seen.request).toEqual({ input: { n: 4 } });
			expect(seen.response).toEqual({ successful: true, output: { id: 8 } });
		}, 30_000);

		it("hands cases mode one entry per case, a failed one too", async () => {
			const seen = await seenByTeardown(
				workflowBoot({ mode: "cases", raw: [{ name: "one", input: { n: 1 } }, { n: 13 }] }),
			);
			expect(seen.request).toEqual([
				{ name: "one", input: { n: 1 } },
				{ name: "Case 2", input: { n: 13 } },
			]);
			expect(seen.response).toEqual([
				{ name: "one", successful: true, output: { id: 2 } },
				{ name: "Case 2", successful: false, error: expect.stringContaining("unlucky") },
			]);
		}, 30_000);

		it("keeps the cases that finished when a later one hangs", async () => {
			const hanging = compileGraph(
				[
					block("1", BlockTypes.entrypoint),
					block("2", BlockTypes.jsrunner, {
						value: "if (input.n === 2) await new Promise(() => {}); return { id: input.n };",
					}),
					block("3", BlockTypes.response, { httpCode: "200" }),
				],
				[edge("1", "2"), edge("2", "3")] as any,
				{ asWorkflow: true, hooks: true },
			).source;
			const seen = await seenByTeardown({
				...workflowBoot({ mode: "cases", raw: [{ n: 1 }, { n: 2 }] }),
				source: hanging,
				timeoutMs: 1_000,
			} as TestBootstrap);
			expect(seen.outcome).toBe("timeout");
			expect(seen.response).toEqual([{ name: "Case 1", successful: true, output: { id: 1 } }]);
		}, 30_000);
	});
});
