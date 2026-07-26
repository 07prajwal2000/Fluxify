import type z from "zod";
import type { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/app-config/get-all/dto";
import type {
	requestBodySchema as createRequestBodySchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/app-config/create/dto";
import type {
	requestBodySchema as updateRequestBodySchema,
	responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/app-config/update/dto";
import type { responseSchema as getOneResponseSchema } from "@fluxify/server/src/api/v1/app-config/get-by-id/dto";
import type {
	requestBodySchema as deleteBulkRequestBodySchema,
	responseSchema as deleteBulkResponseSchema,
} from "@fluxify/server/src/api/v1/app-config/delete-bulk/dto";
import { httpClient } from "@/lib/http";

const baseUrl = (projectId: string) => `/v1/${projectId}/app-config`;

export type ListAppConfigQuery = {
	page?: number;
	perPage?: number;
	search?: string;
	sort?: "asc" | "desc";
	sortBy?: "id" | "keyName" | "createdAt" | "updatedAt" | "isEncrypted" | "encodingType";
};

export type CreateAppConfigBody = z.infer<typeof createRequestBodySchema>;
export type UpdateAppConfigBody = z.infer<typeof updateRequestBodySchema>;
export type DeleteBulkAppConfigBody = z.infer<typeof deleteBulkRequestBodySchema>;
export type AppConfigDetail = z.infer<typeof getOneResponseSchema>;

export const appConfigService = {
	async getAll(
		projectId: string,
		query: ListAppConfigQuery,
	): Promise<z.infer<typeof getAllResponseSchema>> {
		const params = new URLSearchParams();
		if (query.page) params.set("page", String(query.page));
		if (query.perPage) params.set("perPage", String(query.perPage));
		if (query.search) params.set("search", query.search);
		if (query.sortBy) params.set("sortBy", query.sortBy);
		if (query.sort) params.set("sort", query.sort);
		const result = await httpClient.get(`${baseUrl(projectId)}/list?${params.toString()}`);
		return result.data;
	},
	async getById(projectId: string, id: number | string): Promise<AppConfigDetail> {
		const result = await httpClient.get(`${baseUrl(projectId)}/${id}`);
		return result.data;
	},
	async create(
		projectId: string,
		body: CreateAppConfigBody,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(baseUrl(projectId), body);
		return result.data;
	},
	async update(
		projectId: string,
		id: number | string,
		body: UpdateAppConfigBody,
	): Promise<z.infer<typeof updateResponseSchema>> {
		const result = await httpClient.put(`${baseUrl(projectId)}/${id}`, body);
		return result.data;
	},
	async delete(projectId: string, id: number | string) {
		await httpClient.delete(`${baseUrl(projectId)}/${id}`);
	},
	async deleteBulk(
		projectId: string,
		body: DeleteBulkAppConfigBody,
	): Promise<z.infer<typeof deleteBulkResponseSchema>> {
		const result = await httpClient.post(`${baseUrl(projectId)}/delete-bulk`, body);
		return result.data;
	},
	async getKeysList(projectId: string, search: string): Promise<string[]> {
		const params = new URLSearchParams();
		if (search) params.set("search", search);
		const result = await httpClient.get(`${baseUrl(projectId)}/keys?${params.toString()}`);
		return result.data;
	},
};

