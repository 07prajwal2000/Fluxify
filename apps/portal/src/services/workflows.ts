import type z from "zod";
import {
	createdSchema,
	createSchema,
	listSchema,
	patchSchema,
	runAcceptedSchema,
	workflowSchema,
} from "@fluxify/server/src/api/v1/workflows/dto";
import { httpClient } from "@/lib/http";
import { canvasEndpoints } from "./canvas";

const baseUrl = "/v1/workflows";

export type ListWorkflowsQuery = {
	projectId: string;
	page?: number;
	perPage?: number;
	search?: string;
	active?: boolean;
};
export type CreateWorkflowBody = z.infer<typeof createSchema>;
export type UpdateWorkflowBody = z.infer<typeof patchSchema>;
export type Workflow = z.infer<typeof workflowSchema>;

export const workflowsService = {
	async getAll(query: ListWorkflowsQuery): Promise<z.infer<typeof listSchema>> {
		const params = new URLSearchParams({
			page: String(query.page ?? 1),
			perPage: String(query.perPage ?? 10),
			projectId: query.projectId,
		});
		if (query.search) params.set("search", query.search);
		if (query.active !== undefined) params.set("active", String(query.active));
		const result = await httpClient.get(`${baseUrl}/list?${params.toString()}`);
		return result.data;
	},
	async getById(id: string): Promise<Workflow> {
		const result = await httpClient.get(`${baseUrl}/${id}`);
		return result.data;
	},
	async create(data: CreateWorkflowBody): Promise<z.infer<typeof createdSchema>> {
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async update(id: string, data: UpdateWorkflowBody): Promise<Workflow> {
		const result = await httpClient.patch(`${baseUrl}/${id}`, data);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	/** Queues one run. The payload is whatever the workflow's input shape accepts. */
	async run(id: string, payload: unknown): Promise<z.infer<typeof runAcceptedSchema>> {
		const result = await httpClient.post(`${baseUrl}/${id}/run`, { payload });
		return result.data;
	},
	// a workflow's canvas is stored and served exactly like a route's
	...canvasEndpoints(baseUrl),
	createSchema,
};
