import type {
	createBodySchema,
	getResponseSchema,
	idResponseSchema,
	listResponseSchema,
	routeMiddlewaresBodySchema,
	routeMiddlewaresResponseSchema,
	updateBodySchema,
} from "@fluxify/server/src/api/v1/middlewares/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/middlewares";

export type MiddlewareSummary = z.infer<typeof listResponseSchema>[number];
export type Middleware = z.infer<typeof getResponseSchema>;
export type RouteMiddlewares = z.infer<typeof routeMiddlewaresResponseSchema>;
type IdResponse = z.infer<typeof idResponseSchema>;

/** #534: named chains of middleware custom blocks, and each route's list of them */
export const middlewaresService = {
	async getAll(projectId: string): Promise<MiddlewareSummary[]> {
		return (await httpClient.get(`${baseUrl}/list?projectId=${projectId}`)).data;
	},
	async get(id: string): Promise<Middleware> {
		return (await httpClient.get(`${baseUrl}/${id}`)).data;
	},
	async create(body: z.infer<typeof createBodySchema>): Promise<IdResponse> {
		return (await httpClient.post(baseUrl, body)).data;
	},
	async update(id: string, body: z.infer<typeof updateBodySchema>): Promise<IdResponse> {
		return (await httpClient.put(`${baseUrl}/${id}`, body)).data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	async getForRoute(routeId: string): Promise<RouteMiddlewares> {
		return (await httpClient.get(`/v1/routes/${routeId}/middlewares`)).data;
	},
	async setForRoute(
		routeId: string,
		body: z.infer<typeof routeMiddlewaresBodySchema>,
	): Promise<IdResponse> {
		return (await httpClient.put(`/v1/routes/${routeId}/middlewares`, body)).data;
	},
};
