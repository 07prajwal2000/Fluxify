import type {
	callBodySchema,
	callResultSchema,
} from "@fluxify/server/src/api/v1/routes/call/service";
import {
	requestBodySchema as createRequestSchema,
	type responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/routes/create/dto";
import type { responseSchema as exportResponseSchema } from "@fluxify/server/src/api/v1/routes/export/dto";
import type { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/routes/get-all/dto";
import type { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";
import type { responseSchema as importResponseSchema } from "@fluxify/server/src/api/v1/routes/import/dto";
import type { responseSchema as importCheckResponseSchema } from "@fluxify/server/src/api/v1/routes/import-check/dto";
// type-only: this dto value-imports the HttpMethod enum, which drags drizzle
// (and Node's `vm`) into the browser bundle. Only its shape is needed here.
import type { requestBodySchema as updateRequestSchema } from "@fluxify/server/src/api/v1/routes/update/dto";
import type { requestBodySchema as updatePartialRequestSchema } from "@fluxify/server/src/api/v1/routes/update-partial/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";
import { canvasEndpoints } from "./canvas";

export type RouteCallBody = z.infer<typeof callBodySchema>;
export type RouteCallResult = z.infer<typeof callResultSchema>;

/** the file a route exports to; also what an import takes */
export type RouteBundle = z.infer<typeof exportResponseSchema>;
export type RouteImportConflicts = z.infer<typeof importCheckResponseSchema>;
export type RouteImportResult = z.infer<typeof importResponseSchema>;

export type RouteDetail = z.infer<typeof getByIdResponseSchema>;

const baseUrl = "/v1/routes";

export type ListRoutesQuery = {
	page?: number;
	perPage?: number;
	projectId: string;
	search?: string;
	sortBy?: "createdAt" | "updatedAt" | "name";
	sortOrder?: "asc" | "desc";
};

export type { CanvasSavePayload } from "./canvas";
export type UpdateRouteBody = z.infer<typeof updateRequestSchema>;

export const routesService = {
	async getAll(query: ListRoutesQuery): Promise<z.infer<typeof getAllResponseSchema>> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 10));
		params.set("projectId", query.projectId);
		if (query.search) params.set("search", query.search);
		if (query.sortBy) params.set("sortBy", query.sortBy);
		if (query.sortOrder) params.set("sortOrder", query.sortOrder);
		const result = await httpClient.get(`${baseUrl}/list?${params.toString()}`);
		return result.data;
	},
	async create(
		data: z.infer<typeof createRequestSchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async updatePartial(id: string, data: z.infer<typeof updatePartialRequestSchema>) {
		const result = await httpClient.patch(`${baseUrl}/partial/${id}`, data);
		return result.data;
	},
	async update(id: string, data: UpdateRouteBody) {
		const result = await httpClient.put(`${baseUrl}/${id}`, data);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	/** Runs the route for real through the admin API; `debug` adds the real error on failure. */
	async call(routeId: string, body: RouteCallBody): Promise<RouteCallResult> {
		const result = await httpClient.post(`${baseUrl}/${routeId}/call`, body);
		return result.data;
	},
	...canvasEndpoints(baseUrl),
	/** The route as a portable bundle; `includeTests: false` leaves its test suites out. */
	async export(routeId: string, includeTests: boolean): Promise<RouteBundle> {
		const result = await httpClient.get(`${baseUrl}/${routeId}/export`, {
			params: { includeTests },
		});
		return result.data;
	},
	/** Creates a route (canvas and tests included) from a bundle; `warnings` lists what was left out. */
	async import(projectId: string, bundle: RouteBundle): Promise<RouteImportResult> {
		const result = await httpClient.post(`${baseUrl}/import`, { projectId, bundle });
		return result.data;
	},
	/** What a route about to be imported would clash with in the project; changes nothing. */
	async checkImport(
		projectId: string,
		route: { name: string; path: string; method: RouteBundle["route"]["method"] },
	): Promise<RouteImportConflicts> {
		const result = await httpClient.post(`${baseUrl}/import/check`, { projectId, ...route });
		return result.data;
	},
	async getById(routeId: string): Promise<z.infer<typeof getByIdResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/${routeId}`);
		return result.data;
	},
	createRequestSchema,
};
