import type {
	requestBodySchema as createRequestBodySchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/test-suites/create/dto";
import type { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-all/dto";
import type { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-by-id/dto";
import type { responseSchema as getRunResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-run-by-id/dto";
import type { responseSchema as getRunsResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-runs/dto";
import type { responseSchema as startRunResponseSchema } from "@fluxify/server/src/api/v1/test-suites/start-run/dto";
import type {
	requestBodySchema as updateRequestBodySchema,
	responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/test-suites/update/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

/** What a suite tests: a route, or a workflow (#487). */
export type SuiteTarget = { type: "route" | "workflow"; id: string };

/** Suite CRUD resolves the project from the suite itself, so it has no project segment. */
const suitesUrl = "/v1/test-suites";
const targetSuitesUrl = (target: SuiteTarget) => `${suitesUrl}/${target.type}/${target.id}`;
/** Runs carry the project in the path — the server authorizes off it directly. */
const runsUrl = (projectId: string, target: SuiteTarget) =>
	`/v1/${projectId}/test-suites/${target.type}/${target.id}/runs`;

export type TestSuiteList = z.infer<typeof getAllResponseSchema>;
export type TestSuiteDetail = z.infer<typeof getByIdResponseSchema>;
export type CreateTestSuiteBody = z.infer<typeof createRequestBodySchema>;
export type UpdateTestSuiteBody = z.infer<typeof updateRequestBodySchema>;
export type TestRunList = z.infer<typeof getRunsResponseSchema>;
export type TestRunDetail = z.infer<typeof getRunResponseSchema>;
export type TestRunStatus = TestRunDetail["status"];

/** Statuses a run can still move on from — the only reason to keep polling. */
export const IN_FLIGHT_STATUSES: TestRunStatus[] = ["queued", "running"];

export const testSuitesService = {
	async getAll(target: SuiteTarget): Promise<TestSuiteList> {
		const result = await httpClient.get(targetSuitesUrl(target));
		return result.data;
	},
	async getById(id: string): Promise<TestSuiteDetail> {
		const result = await httpClient.get(`${suitesUrl}/${id}`);
		return result.data;
	},
	async create(
		target: SuiteTarget,
		body: CreateTestSuiteBody,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(targetSuitesUrl(target), body);
		return result.data;
	},
	async update(
		id: string,
		body: UpdateTestSuiteBody,
	): Promise<z.infer<typeof updateResponseSchema>> {
		const result = await httpClient.put(`${suitesUrl}/${id}`, body);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${suitesUrl}/${id}`);
	},

	/**
	 * Queues a run and returns immediately with its id — the suites report
	 * progress by updating their own rows, so the caller polls `getRun`.
	 * Omit `suiteIds` to run every suite on the target.
	 */
	async startRun(
		projectId: string,
		target: SuiteTarget,
		suiteIds?: string[],
	): Promise<z.infer<typeof startRunResponseSchema>> {
		const result = await httpClient.post(runsUrl(projectId, target), {
			suiteIds,
		});
		return result.data;
	},
	async getRuns(
		projectId: string,
		target: SuiteTarget,
		query: { page?: number; perPage?: number } = {},
	): Promise<TestRunList> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 10));
		const result = await httpClient.get(`${runsUrl(projectId, target)}?${params.toString()}`);
		return result.data;
	},
	/** Clears every recorded run for the target. */
	async clearRuns(projectId: string, target: SuiteTarget): Promise<{ deleted: number }> {
		const result = await httpClient.delete(runsUrl(projectId, target));
		return result.data;
	},
	async getRun(projectId: string, target: SuiteTarget, runId: string): Promise<TestRunDetail> {
		const result = await httpClient.get(`${runsUrl(projectId, target)}/${runId}`);
		return result.data;
	},
};
