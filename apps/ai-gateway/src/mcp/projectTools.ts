import { installRequestSchema } from "@fluxify/server/src/api/v1/projects/settings/packages/dto";
import { requestBodySchema as projectUpdate } from "@fluxify/server/src/api/v1/projects/update/dto";
import { z } from "zod";
import type { AdminApi } from "./adminApi";
import { type McpTool, page, pick, projectId } from "./tools";

const SAVE = { readOnlyHint: false, destructiveHint: false };
const REMOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

/** How long run_test_suite waits for a result before handing back the run id. */
const WAIT_TRIES = 20;
const WAIT_STEP_MS = 500;
/** An error message can carry a whole stack; this is enough to act on. */
const MAX_ERROR_CHARS = 500;
const PENDING = new Set(["queued", "running"]);

const testSuiteId = z.string().describe("Test suite id, from list_test_suites");
const userId = z.string().describe("The member's user id, from list_members");
const role = z.enum(["viewer", "creator", "project_admin"]);

const cut = (s: unknown) =>
	typeof s === "string" && s.length > MAX_ERROR_CHARS ? `${s.slice(0, MAX_ERROR_CHARS)}…` : s;

/** The runs path of a suite's route or workflow; runs carry the project in the path. */
async function runsPath({ get }: AdminApi, suiteId: string) {
	const suite = await get(`/v1/test-suites/${suiteId}`);
	const [kind, id] = suite.routeId ? ["route", suite.routeId] : ["workflow", suite.workflowId];
	const target = await get(`/v1/${kind}s/${id}`);
	return `/v1/${target.projectId}/test-suites/${kind}/${id}/runs`;
}

/**
 * One suite's part of a run, per case: pass/fail and why. A route suite has no
 * cases yet, so its request reads as the one case. Inputs and outputs are left out.
 */
export function suiteResult(s: any) {
	const r = s.result ?? {};
	const failedChecks = (checks: any[] = []) =>
		checks.filter((c) => !c.success).map((c) => cut(c.message));
	// each case's recorded run, for get_recording; a route suite's request is case 0
	const traceRunId = (i: number) =>
		s.traces?.find((t: any) => t.caseIndex === i)?.traceRunId as string | undefined;
	const cases = r.cases
		? r.cases.map((c: any, i: number) => ({
				name: c.name,
				status: c.status,
				error: cut(c.error),
				failedChecks: failedChecks(c.checks),
				traceRunId: traceRunId(i),
			}))
		: s.result && [
				{
					name: "request",
					status: r.success ? "passed" : "failed",
					statusCode: r.statusCode,
					error: cut(r.error),
					failedChecks: failedChecks(r.result),
					traceRunId: traceRunId(0),
				},
			];
	return {
		...pick(s, ["testSuiteId", "status", "durationMs"]),
		cases,
		teardownError: cut(r.teardownError),
	};
}

const kind = z.enum(["route", "workflow"]).describe("Whether targetId is a route or a workflow");
const targetId = z
	.string()
	.describe("The route or workflow id, from list_routes or list_workflows");
const recordings = (a: { projectId: string; kind: string; targetId: string }) =>
	`/v1/${a.projectId}/recordings/${a.kind}/${a.targetId}/runs`;
const RECORDING_NOTE =
	"Runs exist only while the route or workflow has recordExecution on (save_route, save_workflow), and for every test run. Recorded data is kept as-is, so it can hold headers, bodies and secrets.";

/** A span without its payloads: enough to find the block that failed. */
const shortSpan = ({ input: _i, output: _o, metadata, error, ...span }: any) => ({
	...span,
	error: cut(error),
	mocked: metadata?.mocked,
});

const runResult = (run: any, suiteId?: string) => ({
	runId: run.id,
	...pick(run, ["status", "passedCount", "failedCount", "durationMs", "createdAt"]),
	suites: run.suiteRuns.filter((s: any) => !suiteId || s.testSuiteId === suiteId).map(suiteResult),
});

export const projectTools: McpTool[] = [
	{
		name: "run_test_suite",
		description:
			"Run one test suite for real, as the portal's Run button does: setup hooks, requests and workflow runs all happen. Waits about 10 seconds for the result; if the run is not done by then it returns the run id, and get_test_runs reads the result later.",
		role: "creator",
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
		input: { testSuiteId },
		call: async (api, a) => {
			const runs = await runsPath(api, a.testSuiteId);
			const { runId } = await api.send("POST", runs, { suiteIds: [a.testSuiteId] });
			for (let i = 0; i < WAIT_TRIES; i++) {
				const run = await api.get(`${runs}/${runId}`);
				if (!PENDING.has(run.status)) return runResult(run);
				await Bun.sleep(WAIT_STEP_MS);
			}
			return {
				runId,
				status: "running",
				message: "Not done yet. Call get_test_runs with this suite id for the result.",
			};
		},
	},
	{
		name: "get_test_runs",
		description:
			"A test suite's recent runs, newest first, with each case's pass/fail and error. Each case's traceRunId is its recorded run: read it with get_recording (kind and targetId are the suite's route or workflow, from get_test_suite).",
		role: "creator",
		input: {
			testSuiteId,
			limit: z.number().int().min(1).max(10).optional().describe("How many runs, 5 by default"),
		},
		call: async (api, a) => {
			const runs = await runsPath(api, a.testSuiteId);
			// runs are per route or workflow, so other suites' runs are skipped
			const { data } = await api.get(runs, { perPage: 50 });
			const out = [];
			for (const summary of data) {
				if (out.length >= (a.limit ?? 5)) break;
				const run = await api.get(`${runs}/${summary.id}`);
				if (run.suiteRuns.some((s: any) => s.testSuiteId === a.testSuiteId)) {
					out.push(runResult(run, a.testSuiteId));
				}
			}
			return out;
		},
	},
	{
		name: "list_recordings",
		description: `A route's or workflow's recorded runs, newest first: outcome, status code, timing and span count. ${RECORDING_NOTE} Read one run with get_recording.`,
		role: "creator",
		input: {
			projectId,
			kind,
			targetId,
			outcome: z.enum(["success", "failure"]).optional().describe("Only runs that ended this way"),
			source: z
				.enum(["test", "live"])
				.optional()
				.describe("test: only test run traces, live: only normal runs. Both by default"),
			testRunId: z.string().optional().describe("Only the traces of this test run"),
			from: z.string().optional().describe("Only runs started at or after this ISO time"),
			to: z.string().optional().describe("Only runs started before this ISO time"),
			page,
		},
		call: async ({ get }, a) => {
			const body = await get(recordings(a), {
				...pick(a, ["outcome", "source", "testRunId", "from", "to", "page"]),
				perPage: 50,
			});
			return {
				items: body.data.map((r: any) => ({
					...pick(r, [
						"id",
						"startedAt",
						"endedAt",
						"durationMs",
						"outcome",
						"statusCode",
						"spanCount",
						"truncated",
					]),
					testLabel: r.metadata?.label,
				})),
				page: body.pagination.page,
				hasNext: body.pagination.hasNext,
			};
		},
	},
	{
		name: "get_recording",
		description: `One recorded run: its fields, test info (metadata), the async runs it forked (childRuns) and its spans in order, one per block that ran, with outcome, branch, error and truncated / mocked flags. Spans leave out input and output: pass spanSeq for one span in full, or full: true for everything (a run can be 256 KB). ${RECORDING_NOTE}`,
		role: "creator",
		input: {
			projectId,
			kind,
			targetId,
			runId: z.string().describe("Run id, from list_recordings or a get_test_runs traceRunId"),
			spanSeq: z
				.number()
				.int()
				.optional()
				.describe("Return only this span, input and output included"),
			full: z.boolean().optional().describe("Every span with its input and output"),
		},
		call: async ({ get }, a) => {
			const run = await get(`${recordings(a)}/${a.runId}`);
			if (a.spanSeq !== undefined) {
				const span = run.spans.find((s: any) => s.seq === a.spanSeq);
				if (!span) throw new Error(`This run has no span ${a.spanSeq}.`);
				return span;
			}
			return a.full ? run : { ...run, spans: run.spans.map(shortSpan) };
		},
	},
	{
		name: "add_member",
		description:
			"Add a user to a project with a role: viewer reads, creator builds, project_admin also manages members, packages and settings. The user must already have a Fluxify account.",
		role: "project_admin",
		annotations: SAVE,
		input: {
			projectId,
			user: z.string().describe("The user's email or user id"),
			role,
		},
		call: async ({ get, send }, a) => {
			let id = a.user;
			if (a.user.includes("@")) {
				const { data } = await get("/auth/list-users", { fuzzySearch: a.user, perPage: 50 });
				const match = data.find((u: any) => u.email.toLowerCase() === a.user.toLowerCase());
				if (!match) throw new Error(`No Fluxify user has the email ${a.user}.`);
				id = match.id;
			}
			await send("POST", `/v1/projects/${a.projectId}/settings/members/add`, {
				userId: id,
				role: a.role,
			});
			return { userId: id, role: a.role };
		},
	},
	{
		name: "update_member_role",
		description: "Change a project member's role.",
		role: "project_admin",
		annotations: { ...SAVE, idempotentHint: true },
		input: { projectId, userId, role },
		call: async ({ send }, a) =>
			pick(
				await send("PUT", `/v1/projects/${a.projectId}/settings/members/update/${a.userId}`, {
					role: a.role,
				}),
				["userId", "role"],
			),
	},
	{
		name: "remove_member",
		description: "Remove a member from a project. They lose all access to it at once.",
		role: "project_admin",
		annotations: REMOVE,
		input: { projectId, userId },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/projects/${a.projectId}/settings/members/remove/${a.userId}`);
			return { removed: a.userId };
		},
	},
	{
		name: "list_packages",
		description: "The npm packages a project's code can import, with their pinned versions.",
		role: "creator",
		input: { projectId },
		call: async ({ get }, a) =>
			(await get(`/v1/projects/${a.projectId}/settings/packages`)).packages,
	},
	{
		name: "install_package",
		description:
			"Install npm packages for a project's code, from the npm registry. Workers install them in the background. trust lets their install scripts run: only for packages you trust.",
		role: "project_admin",
		annotations: { ...SAVE, openWorldHint: true },
		input: { projectId, ...installRequestSchema.shape },
		call: async ({ send }, { projectId: p, ...body }) =>
			(await send("POST", `/v1/projects/${p}/settings/packages/install`, body)).packages,
	},
	{
		name: "remove_package",
		description: "Uninstall npm packages from a project. Code that imports them will fail.",
		role: "project_admin",
		annotations: REMOVE,
		input: { projectId, names: z.array(z.string().min(1)).min(1).max(50) },
		call: async ({ send }, a) =>
			(
				await send("POST", `/v1/projects/${a.projectId}/settings/packages/remove`, {
					names: a.names,
				})
			).packages,
	},
	{
		name: "update_project",
		description:
			"Change a project's name, description or whether it is hidden. Only the fields given change.",
		role: "project_admin",
		annotations: { ...SAVE, idempotentHint: true },
		input: { projectId, ...projectUpdate.shape },
		call: async ({ send }, { projectId: p, ...body }) =>
			pick(await send("PUT", `/v1/projects/${p}`, body), ["id", "name", "description", "hidden"]),
	},
];
