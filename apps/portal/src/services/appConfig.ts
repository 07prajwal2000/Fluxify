import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/app-config/get-all/dto";
import {
	requestBodySchema as createRequestBodySchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/app-config/create/dto";
import { httpClient } from "@/lib/http";

const baseUrl = (projectId: string) => `/v1/${projectId}/app-config`;

export type ListAppConfigQuery = { page?: number; perPage?: number };

export const appConfigService = {
	async getAll(
		projectId: string,
		query: ListAppConfigQuery,
	): Promise<z.infer<typeof getAllResponseSchema>> {
		const params = new URLSearchParams();
		params.set("page", String(query.page ?? 1));
		params.set("perPage", String(query.perPage ?? 20));
		const result = await httpClient.get(`${baseUrl(projectId)}/list?${params}`);
		return result.data;
	},
	async create(
		projectId: string,
		body: z.infer<typeof createRequestBodySchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(baseUrl(projectId), body);
		return result.data;
	},
	async delete(projectId: string, id: number) {
		await httpClient.delete(`${baseUrl(projectId)}/${id}`);
	},
	createRequestBodySchema,
};
