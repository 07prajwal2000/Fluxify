import type { responseSchema as deleteResponseSchema } from "@fluxify/server/src/api/v1/recordings/delete-runs/dto";
import type { responseSchema as getRunResponseSchema } from "@fluxify/server/src/api/v1/recordings/get-run-by-id/dto";
import type { responseSchema as getRunsResponseSchema } from "@fluxify/server/src/api/v1/recordings/get-runs/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";
import { sandboxesBase } from "./sandboxes";
import type { SuiteTarget } from "./testSuites";

/** What was recorded: a route or a workflow, as test runs do, or a sandbox. */
export type RecordingTarget = SuiteTarget | { type: "sandbox"; id: string };
export type RecordedRunList = z.infer<typeof getRunsResponseSchema>;
export type RecordedRunSummary = RecordedRunList["data"][number];
export type RecordedRun = z.infer<typeof getRunResponseSchema>;
export type RecordedSpan = RecordedRun["spans"][number];
/** set on a test run's trace (#627) */
export type TraceMetadata = NonNullable<RecordedRun["metadata"]>;
/** narrows the list to test traces (#627) or normal runs; without it, both */
export type TestTraceFilter = { source?: "test" | "live"; testRunId?: string };

/**
 * The project is in the path — the server authorizes off it directly (creator
 * only). A sandbox's runs are served by the sandbox itself, which also checks
 * that it is yours.
 */
const runsUrl = (projectId: string, target: RecordingTarget) =>
	target.type === "sandbox"
		? `${sandboxesBase(projectId)}/${target.id}/runs`
		: `/v1/${projectId}/recordings/${target.type}/${target.id}/runs`;

export const recordingsService = {
	/** newest first, headers only */
	async getRuns(
		projectId: string,
		target: RecordingTarget,
		query: {
			page?: number;
			perPage?: number;
			outcome?: "success" | "failure";
		} & TestTraceFilter = {},
	): Promise<RecordedRunList> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 20));
		if (query.outcome) {
			params.set("outcome", query.outcome);
		}
		if (query.source) params.set("source", query.source);
		if (query.testRunId) params.set("testRunId", query.testRunId);
		const result = await httpClient.get(`${runsUrl(projectId, target)}?${params.toString()}`);
		return result.data;
	},
	/** one run with every span; also opens an async child run */
	async getRun(projectId: string, target: RecordingTarget, runId: string): Promise<RecordedRun> {
		const result = await httpClient.get(`${runsUrl(projectId, target)}/${runId}`);
		return result.data;
	},
	async deleteRun(
		projectId: string,
		target: RecordingTarget,
		runId: string,
	): Promise<z.infer<typeof deleteResponseSchema>> {
		const result = await httpClient.delete(`${runsUrl(projectId, target)}/${runId}`);
		return result.data;
	},
	async clearRuns(
		projectId: string,
		target: RecordingTarget,
	): Promise<z.infer<typeof deleteResponseSchema>> {
		const result = await httpClient.delete(runsUrl(projectId, target));
		return result.data;
	},
};
