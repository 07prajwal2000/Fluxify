import {
	requestBodySchema as createRequestBodySchema,
	type responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/projects/create/dto";
import {
	requestQuerySchema as getAllRequestQuerySchema,
	type responseSchema as getAllResponseSchema,
} from "@fluxify/server/src/api/v1/projects/get-all/dto";
import type { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/projects/get-by-id/dto";
import {
	requestBodySchema as updateRequestBodySchema,
	type responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/projects/update/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/projects";

export type GetAllProjectsQueryParams = z.infer<typeof getAllRequestQuerySchema>;

export const projectsService = {
	async getAll(
		query: z.infer<typeof getAllRequestQuerySchema>,
	): Promise<z.infer<typeof getAllResponseSchema>> {
		const { success } = getAllRequestQuerySchema.safeParse(query);
		if (!success) throw new Error("Invalid query params for getAll projects");
		const url = `${baseUrl}/list?page=${query?.page ?? 1}&perPage=${query?.perPage ?? 50}`;
		const result = await httpClient.get(url);
		return result.data;
	},
	async create(
		data: z.infer<typeof createRequestBodySchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const { success } = createRequestBodySchema.safeParse(data);
		if (!success) throw new Error("Invalid data for create project");
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async update(
		id: string,
		data: z.infer<typeof updateRequestBodySchema>,
	): Promise<z.infer<typeof updateResponseSchema>> {
		const { success } = updateRequestBodySchema.safeParse(data);
		if (!success) throw new Error("Invalid data for update project");
		const result = await httpClient.put(`${baseUrl}/${id}`, data);
		return result.data;
	},
	async getById(id: string): Promise<z.infer<typeof getByIdResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/${id}`);
		return result.data;
	},
	createRequestBodySchema,
	updateRequestBodySchema,
};
