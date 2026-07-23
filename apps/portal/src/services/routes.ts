import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/routes/get-all/dto";
import {
	requestBodySchema as createRequestSchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/routes/create/dto";
import { requestBodySchema as updatePartialRequestSchema } from "@fluxify/server/src/api/v1/routes/update-partial/dto";
import { responseSchema as canvasItemsResponseSchema } from "@fluxify/server/src/api/v1/routes/get-canvas-items/dto";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/routes";

export type ListRoutesQuery = { page?: number; perPage?: number; projectId: string };

export const routesService = {
	async getAll(
		query: ListRoutesQuery,
	): Promise<z.infer<typeof getAllResponseSchema>> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 10));
		params.set("projectId", query.projectId);
		const result = await httpClient.get(`${baseUrl}/list?${params.toString()}`);
		return result.data;
	},
	async create(
		data: z.infer<typeof createRequestSchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async updatePartial(
		id: string,
		data: z.infer<typeof updatePartialRequestSchema>,
	) {
		const result = await httpClient.patch(`${baseUrl}/partial/${id}`, data);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	async getCanvasItems(
		routeId: string,
	): Promise<z.infer<typeof canvasItemsResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/${routeId}/canvas-items`);
		return result.data;
	},
	async getById(
		routeId: string,
	): Promise<z.infer<typeof getByIdResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/${routeId}`);
		return result.data;
	},
	createRequestSchema,
};
