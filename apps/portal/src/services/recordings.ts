import type { responseSchema as deleteResponseSchema } from "@fluxify/server/src/api/v1/recordings/delete-runs/dto";
import type { responseSchema as getRunResponseSchema } from "@fluxify/server/src/api/v1/recordings/get-run-by-id/dto";
import type { responseSchema as getRunsResponseSchema } from "@fluxify/server/src/api/v1/recordings/get-runs/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";
import type { SuiteTarget } from "./testSuites";

/** What was recorded: a route or a workflow — the same pair test runs use. */
export type RecordingTarget = SuiteTarget;
export type RecordedRunList = z.infer<typeof getRunsResponseSchema>;
export type RecordedRunSummary = RecordedRunList["data"][number];
export type RecordedRun = z.infer<typeof getRunResponseSchema>;
export type RecordedSpan = RecordedRun["spans"][number];

/** The project is in the path — the server authorizes off it directly (creator only). */
const runsUrl = (projectId: string, target: RecordingTarget) =>
	`/v1/${projectId}/recordings/${target.type}/${target.id}/runs`;

export const recordingsService = {
	/** newest first, headers only */
	async getRuns(
		projectId: string,
		target: RecordingTarget,
		query: { page?: number; perPage?: number; outcome?: "success" | "failure" } = {},
	): Promise<RecordedRunList> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 20));
		if (query.outcome) {
			params.set("outcome", query.outcome);
		}
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
