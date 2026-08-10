import type z from "zod";
import type { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-all/dto";
import type { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-by-id/dto";
import type {
	requestBodySchema as createRequestBodySchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/test-suites/create/dto";
import type {
	requestBodySchema as updateRequestBodySchema,
	responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/test-suites/update/dto";
import type { responseSchema as startRunResponseSchema } from "@fluxify/server/src/api/v1/test-suites/start-run/dto";
import type { responseSchema as getRunsResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-runs/dto";
import type { responseSchema as getRunResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-run-by-id/dto";
import { httpClient } from "@/lib/http";

/** Suite CRUD resolves the project from the suite itself, so it has no project segment. */
const suitesUrl = "/v1/test-suites";
const routeSuitesUrl = (routeId: string) => `${suitesUrl}/route/${routeId}`;
/** Runs carry the project in the path — the server authorizes off it directly. */
const runsUrl = (projectId: string, routeId: string) =>
	`/v1/${projectId}/test-suites/route/${routeId}/runs`;

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
	async getAll(routeId: string): Promise<TestSuiteList> {
		const result = await httpClient.get(routeSuitesUrl(routeId));
		return result.data;
	},
	async getById(id: string): Promise<TestSuiteDetail> {
		const result = await httpClient.get(`${suitesUrl}/${id}`);
		return result.data;
	},
	async create(
		routeId: string,
		body: CreateTestSuiteBody,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(routeSuitesUrl(routeId), body);
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
	 * Omit `suiteIds` to run every suite on the route.
	 */
	async startRun(
		projectId: string,
		routeId: string,
		suiteIds?: string[],
	): Promise<z.infer<typeof startRunResponseSchema>> {
		const result = await httpClient.post(runsUrl(projectId, routeId), {
			suiteIds,
		});
		return result.data;
	},
	async getRuns(
		projectId: string,
		routeId: string,
		query: { page?: number; perPage?: number } = {},
	): Promise<TestRunList> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 10));
		const result = await httpClient.get(
			`${runsUrl(projectId, routeId)}?${params.toString()}`,
		);
		return result.data;
	},
	async getRun(
		projectId: string,
		routeId: string,
		runId: string,
	): Promise<TestRunDetail> {
		const result = await httpClient.get(
			`${runsUrl(projectId, routeId)}/${runId}`,
		);
		return result.data;
	},
};
