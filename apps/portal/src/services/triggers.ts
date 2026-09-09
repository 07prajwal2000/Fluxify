import type z from "zod";
import {
	createGroupSchema,
	createSchema,
	groupListSchema,
	listSchema,
	patchSchema,
	triggerSchema,
} from "@fluxify/server/src/api/v1/triggers/dto";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/triggers";

export type ListTriggersQuery = {
	projectId?: string;
	workflowId?: string;
	groupId?: string;
	page?: number;
	perPage?: number;
	search?: string;
	active?: boolean;
};
export type CreateTriggerBody = z.infer<typeof createSchema>;
export type UpdateTriggerBody = z.infer<typeof patchSchema>;
export type Trigger = z.infer<typeof triggerSchema>;
export type TriggerGroup = z.infer<typeof groupListSchema>["data"][number];

export const triggersService = {
	async getAll(query: ListTriggersQuery): Promise<z.infer<typeof listSchema>> {
		const params = new URLSearchParams({
			page: String(query.page ?? 1),
			perPage: String(query.perPage ?? 50),
		});
		for (const key of ["projectId", "workflowId", "groupId", "search"] as const) {
			if (query[key]) params.set(key, query[key] as string);
		}
		if (query.active !== undefined) params.set("active", String(query.active));
		const result = await httpClient.get(`${baseUrl}/list?${params.toString()}`);
		return result.data;
	},
	async create(data: CreateTriggerBody): Promise<{ id: string }> {
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async update(id: string, data: UpdateTriggerBody): Promise<Trigger> {
		const result = await httpClient.patch(`${baseUrl}/${id}`, data);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	async getGroups(projectId: string): Promise<TriggerGroup[]> {
		const result = await httpClient.get(
			`${baseUrl}/groups?projectId=${encodeURIComponent(projectId)}`,
		);
		return result.data.data;
	},
	async createGroup(data: z.infer<typeof createGroupSchema>): Promise<TriggerGroup> {
		const result = await httpClient.post(`${baseUrl}/groups`, data);
		return result.data;
	},
	createSchema,
};
