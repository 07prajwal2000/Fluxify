import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { projectTools } from "../projectTools";

type Call = { method: string; path: string; body?: unknown; query?: unknown };

/** A fake admin API: records each call, answers GETs from `gets` and sends from `sends`. */
function fakeApi(gets: Record<string, unknown>, sends: Record<string, unknown> = {}) {
	const calls: Call[] = [];
	const api: AdminApi = {
		get: async (path, query) => {
			calls.push({ method: "GET", path, ...(query && { query }) });
			return gets[path];
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			return sends[path] ?? {};
		},
	};
	return { api, calls };
}

const tool = (name: string) => projectTools.find((t) => t.name === name)!;
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

const RUNS = "/v1/p1/test-suites/route/r1/runs";
const suiteGets = {
	"/v1/test-suites/s1": { id: "s1", routeId: "r1", workflowId: null },
	"/v1/routes/r1": { id: "r1", projectId: "p1" },
};

const routeSuiteRun = (id: string, suiteId: string) => ({
	id,
	status: "failed",
	passedCount: 0,
	failedCount: 1,
	durationMs: 12,
	createdAt: "2026-10-07",
	suiteRuns: [
		{
			id: "sr1",
			testSuiteId: suiteId,
			status: "failed",
			durationMs: 12,
			result: {
				success: false,
				statusCode: 500,
				actualData: { huge: "x".repeat(5000) },
				result: [
					{ success: true, message: "status is 500" },
					{ success: false, message: "body.ok equals true" },
				],
			},
		},
	],
});

describe("project tools", () => {
	it("removes and runs are destructive; runs reach the outside world", () => {
		for (const t of projectTools) {
			if (t.name.startsWith("remove_")) expect(t.annotations?.destructiveHint).toBe(true);
		}
		expect(tool("run_test_suite").annotations).toMatchObject({
			destructiveHint: true,
			openWorldHint: true,
		});
		expect(tool("get_test_runs").annotations).toBeUndefined();
	});

	it("run_test_suite runs just that suite and returns pass/fail per case, trimmed", async () => {
		const { api, calls } = fakeApi(
			{ ...suiteGets, [`${RUNS}/run1`]: routeSuiteRun("run1", "s1") },
			{ [RUNS]: { runId: "run1" } },
		);
		const result: any = await run("run_test_suite", { testSuiteId: "s1" }, api);
		expect(calls[2]).toEqual({ method: "POST", path: RUNS, body: { suiteIds: ["s1"] } });
		expect(result).toEqual({
			runId: "run1",
			status: "failed",
			passedCount: 0,
			failedCount: 1,
			durationMs: 12,
			createdAt: "2026-10-07",
			suites: [
				{
					testSuiteId: "s1",
					status: "failed",
					durationMs: 12,
					cases: [
						{
							name: "request",
							status: "failed",
							statusCode: 500,
							error: undefined,
							failedChecks: ["body.ok equals true"],
						},
					],
					teardownError: undefined,
				},
			],
		});
	});

	it("get_test_runs reads a workflow suite's cases and skips runs of other suites", async () => {
		const runs = "/v1/p1/test-suites/workflow/w1/runs";
		const wfRun = {
			id: "a",
			status: "error",
			suiteRuns: [
				{
					testSuiteId: "s1",
					status: "error",
					result: {
						success: false,
						cases: [
							{ name: "one", status: "passed", checks: [{ success: true, message: "ok" }], input: 1 },
							{ name: "two", status: "error", checks: [], error: "e".repeat(900), input: 2 },
						],
					},
				},
				{ testSuiteId: "other", status: "passed", result: null },
			],
		};
		const { api } = fakeApi({
			"/v1/test-suites/s1": { id: "s1", routeId: null, workflowId: "w1" },
			"/v1/workflows/w1": { id: "w1", projectId: "p1" },
			[runs]: { data: [{ id: "a" }, { id: "b" }] },
			[`${runs}/a`]: wfRun,
			[`${runs}/b`]: { id: "b", status: "passed", suiteRuns: [{ testSuiteId: "other" }] },
		});
		const result: any = await run("get_test_runs", { testSuiteId: "s1" }, api);
		expect(result).toHaveLength(1);
		expect(result[0].suites).toHaveLength(1);
		const [one, two] = result[0].suites[0].cases;
		expect(one).toEqual({ name: "one", status: "passed", error: undefined, failedChecks: [] });
		expect(two.error).toHaveLength(501);
	});

	it("each case carries its traceRunId", async () => {
		const traced = routeSuiteRun("run1", "s1");
		Object.assign(traced.suiteRuns[0], { traces: [{ caseIndex: 0, traceRunId: "t1" }] });
		const { api } = fakeApi({ ...suiteGets, [RUNS]: { data: [{ id: "run1" }] }, [`${RUNS}/run1`]: traced });
		const [result]: any = await run("get_test_runs", { testSuiteId: "s1" }, api);
		expect(result.suites[0].cases[0].traceRunId).toBe("t1");
	});

	it("a failed case's debug error replaces its bare message", async () => {
		const debug = { block: { id: "b1", type: "jsrunner" }, message: "boom", stack: "at <anonymous> (fluxify-graph:3:9)" };
		const failed = routeSuiteRun("run1", "s1");
		Object.assign(failed.suiteRuns[0].result, { error: "boom", debug });
		const { api } = fakeApi({ ...suiteGets, [RUNS]: { data: [{ id: "run1" }] }, [`${RUNS}/run1`]: failed });
		const [result]: any = await run("get_test_runs", { testSuiteId: "s1" }, api);
		expect(result.suites[0].cases[0].error).toEqual(debug);
	});

	const REC = "/v1/p1/recordings/workflow/w1/runs";
	const target = { projectId: "p1", kind: "workflow", targetId: "w1" };

	it("list_recordings passes the filters and trims each run", async () => {
		const row = {
			id: "x",
			outcome: "failure",
			statusCode: null,
			startedAt: "a",
			endedAt: "b",
			durationMs: 3,
			spanCount: 2,
			truncated: false,
			droppedSpans: 0,
			parentRunId: null,
			metadata: { source: "test", label: "Suite · case", testRunId: "tr" },
		};
		const { api, calls } = fakeApi({ [REC]: { data: [row], pagination: { page: 1, hasNext: false } } });
		const result = await run("list_recordings", { ...target, outcome: "failure", source: "test" }, api);
		expect(calls[0].query).toMatchObject({ outcome: "failure", source: "test", perPage: 50 });
		expect(result).toEqual({
			items: [
				{
					id: "x",
					startedAt: "a",
					endedAt: "b",
					durationMs: 3,
					outcome: "failure",
					statusCode: null,
					spanCount: 2,
					truncated: false,
					testLabel: "Suite · case",
				},
			],
			page: 1,
			hasNext: false,
		});
	});

	const span = (seq: number, extra = {}) => ({
		seq,
		blockId: `b${seq}`,
		outcome: "success",
		error: null,
		input: { big: "x".repeat(1000) },
		output: { ok: seq },
		truncated: false,
		metadata: { position: { x: 0, y: 0 } },
		...extra,
	});
	const recorded = {
		id: "x",
		metadata: null,
		childRuns: [{ id: "c", parentSeq: 1 }],
		spans: [span(0), span(1, { outcome: "failure", error: "boom", metadata: { mocked: { output: true } } })],
	};

	it("get_recording is short by default, full on request, one span by spanSeq", async () => {
		const { api, calls } = fakeApi({ [`${REC}/x`]: recorded });
		const short: any = await run("get_recording", { ...target, runId: "x" }, api);
		expect(calls[0].path).toBe(`${REC}/x`);
		expect(short.childRuns).toEqual(recorded.childRuns);
		expect(short.spans[1]).toEqual({
			seq: 1,
			blockId: "b1",
			outcome: "failure",
			error: "boom",
			truncated: false,
			mocked: { output: true },
		});
		expect(short.spans[0]).not.toHaveProperty("input");

		expect(await run("get_recording", { ...target, runId: "x", full: true }, api)).toEqual(recorded);
		expect(await run("get_recording", { ...target, runId: "x", spanSeq: 1 }, api)).toEqual(recorded.spans[1]);
		await expect(run("get_recording", { ...target, runId: "x", spanSeq: 9 }, api)).rejects.toThrow(
			"This run has no span 9.",
		);
	});

	it("get_recording names each span's block by its canvas key, in every form", async () => {
		const canvas = { blocks: [{ id: "b0", key: "entrypoint_1" }, { id: "b1", key: "jsrunner_1" }] };
		const { api } = fakeApi({ [`${REC}/x`]: recorded, "/v1/workflows/w1/canvas-items": canvas });
		const short: any = await run("get_recording", { ...target, runId: "x" }, api);
		expect(short.spans.map((s: any) => s.blockKey)).toEqual(["entrypoint_1", "jsrunner_1"]);
		expect(short.spans[1]).toMatchObject({ blockId: "b1", blockKey: "jsrunner_1", outcome: "failure" });
		const full: any = await run("get_recording", { ...target, runId: "x", full: true }, api);
		expect(full.spans.map((s: any) => s.blockKey)).toEqual(["entrypoint_1", "jsrunner_1"]);
		expect(full.spans[0].input).toBeDefined();
		const one: any = await run("get_recording", { ...target, runId: "x", spanSeq: 1 }, api);
		expect(one).toMatchObject({ blockKey: "jsrunner_1", output: { ok: 1 } });
		// a block deleted since has no key, and an unreadable canvas does not fail the read
		const gone = { blocks: [{ id: "b0", key: "entrypoint_1" }] };
		const second = fakeApi({ [`${REC}/x`]: recorded, "/v1/workflows/w1/canvas-items": gone }).api;
		const after: any = await run("get_recording", { ...target, runId: "x" }, second);
		expect(after.spans[1]).not.toHaveProperty("blockKey");
	});

	it("add_member looks an email up and refuses an unknown one without adding anyone", async () => {
		const users = { data: [{ id: "u2", email: "Ana@x.io" }, { id: "u3", email: "ana@x.io.evil" }] };
		const { api, calls } = fakeApi({ "/auth/list-users": users });
		expect(await run("add_member", { projectId: "p1", user: "ana@x.io", role: "creator" }, api)).toEqual({
			userId: "u2",
			role: "creator",
		});
		expect(calls[1]).toEqual({
			method: "POST",
			path: "/v1/projects/p1/settings/members/add",
			body: { userId: "u2", role: "creator" },
		});
		await expect(
			run("add_member", { projectId: "p1", user: "bob@x.io", role: "viewer" }, api),
		).rejects.toThrow("No Fluxify user has the email bob@x.io.");
		expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
	});

	it("update_project sends only the fields given", async () => {
		const { api, calls } = fakeApi({});
		await run("update_project", { projectId: "p1", description: "shop api" }, api);
		expect(calls).toEqual([{ method: "PUT", path: "/v1/projects/p1", body: { description: "shop api" } }]);
	});
});
