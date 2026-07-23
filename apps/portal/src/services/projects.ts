import { httpClient } from "@/lib/http";
import {
	requestQuerySchema as getAllRequestQuerySchema,
	responseSchema as getAllResponseSchema,
} from "@fluxify/server/src/api/v1/projects/get-all/dto";
import {
	requestBodySchema as createRequestBodySchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/projects/create/dto";
import {
	requestBodySchema as updateRequestBodySchema,
	responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/projects/update/dto";
import z from "zod";

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
	createRequestBodySchema,
	updateRequestBodySchema,
};
