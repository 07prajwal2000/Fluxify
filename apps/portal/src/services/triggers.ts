import type z from "zod";
import {
	createGroupSchema,
	createSchema,
	groupListSchema,
	listSchema,
	patchSchema,
	previewSchema,
	triggerCreatedSchema,
	triggerSchema,
	triggerUpdatedSchema,
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
/** A trigger as the list returns it — the workflow comes with its name. */
export type TriggerListItem = z.infer<typeof listSchema>["data"][number];
export type TriggerGroup = z.infer<typeof groupListSchema>["data"][number];
export type SchedulePreview = z.infer<typeof previewSchema>;

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
	/** `warnings`: settings that work but deserve a look, e.g. an SQS queue with no dead-letter queue. */
	async create(data: CreateTriggerBody): Promise<z.infer<typeof triggerCreatedSchema>> {
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async update(id: string, data: UpdateTriggerBody): Promise<z.infer<typeof triggerUpdatedSchema>> {
		const result = await httpClient.patch(`${baseUrl}/${id}`, data);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	/** Refused with 409 when the trigger already starts a different workflow. */
	async attachWorkflow(id: string, workflowId: string): Promise<Trigger> {
		const result = await httpClient.put(`${baseUrl}/${id}/workflows/${workflowId}`);
		return result.data;
	},
	async detachWorkflow(id: string, workflowId: string): Promise<Trigger> {
		const result = await httpClient.delete(`${baseUrl}/${id}/workflows/${workflowId}`);
		return result.data;
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
	/**
	 * The server reads the schedule, not the browser. Same parser and same
	 * timezone database as the thing that will actually run it, so a preview the
	 * user confirms cannot disagree with what fires.
	 */
	async previewSchedule(schedule: string, timezone: string): Promise<SchedulePreview> {
		const params = new URLSearchParams({ schedule, timezone });
		const result = await httpClient.get(
			`${baseUrl}/schedule/preview?${params.toString()}`,
		);
		return result.data;
	},
	createSchema,
};
