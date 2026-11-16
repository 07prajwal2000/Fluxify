import {
	requestBodySchema as createRequestBodySchema,
	type responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/projects/create/dto";
import {
	requestQuerySchema as getAllRequestQuerySchema,
	type responseSchema as getAllResponseSchema,
} from "@fluxify/server/src/api/v1/projects/get-all/dto";
import type { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/projects/get-by-id/dto";
import type {
	inspectResponseSchema,
	restoreResponseSchema,
} from "@fluxify/server/src/api/v1/projects/restore/dto";
import {
	requestBodySchema as updateRequestBodySchema,
	type responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/projects/update/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/projects";

export type ArchiveSummary = z.infer<typeof inspectResponseSchema>;
export type RestoreResult = z.infer<typeof restoreResponseSchema>;

// the client's JSON default would turn the form into JSON; the browser adds the boundary
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

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
	async remove(id: string): Promise<{ id: string }> {
		const result = await httpClient.delete(`${baseUrl}/${id}`);
		return result.data;
	},
	async getById(id: string): Promise<z.infer<typeof getByIdResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/${id}`);
		return result.data;
	},
	/** checks a backup or template file and says what it holds; creates nothing */
	async inspectArchive(file: File): Promise<ArchiveSummary> {
		const form = new FormData();
		form.set("file", file);
		return (await httpClient.post(`${baseUrl}/restore/inspect`, form, MULTIPART)).data;
	},
	/** a new project from a backup or template file */
	async restore(
		file: File,
		project: { name: string; slug: string; description?: string; subdomain?: string },
	): Promise<RestoreResult> {
		const form = new FormData();
		form.set("file", file);
		for (const [key, value] of Object.entries(project)) if (value) form.set(key, value);
		return (await httpClient.post(`${baseUrl}/restore`, form, MULTIPART)).data;
	},
	createRequestBodySchema,
	updateRequestBodySchema,
};
