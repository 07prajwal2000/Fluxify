import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateTriggerBody,
	type DeleteGroupOptions,
	type ListTriggersQuery,
	triggersService,
	type UpdateTriggerBody,
} from "@/services/triggers";

const LIST_KEY = ["triggers", "list"];
const groupsKey = (projectId: string) => ["triggers", "groups", projectId];
const detailKey = (id: string) => ["triggers", "detail", id];
const pluginKindsKey = (projectId: string, kind?: string) => [
	"triggers",
	"plugin-kinds",
	projectId,
	kind ?? "",
];

export const triggersQuery = {
	getAll: {
		useQuery(query: ListTriggersQuery, enabled = true) {
			return useQuery({
				queryKey: [...LIST_KEY, query],
				queryFn: () => triggersService.getAll(query),
				enabled,
				refetchOnWindowFocus: false,
			});
		},
	},
	byId: {
		useQuery(id: string) {
			return useQuery({
				queryKey: detailKey(id),
				queryFn: () => triggersService.getById(id),
				enabled: Boolean(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	/** `kind` narrows it to one; without it, every kind the project can create */
	pluginKinds: {
		useQuery(projectId: string, kind?: string, enabled = true) {
			return useQuery({
				queryKey: pluginKindsKey(projectId, kind),
				queryFn: () => triggersService.getPluginKinds(projectId, kind),
				enabled: Boolean(projectId) && enabled,
				refetchOnWindowFocus: false,
			});
		},
	},
	groups: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: groupsKey(projectId),
				queryFn: () => triggersService.getGroups(projectId),
				enabled: Boolean(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	createGroup: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: { projectId: string; name: string; description?: string }) =>
					triggersService.createGroup(body),
				onSuccess: (_, body) => qc.invalidateQueries({ queryKey: groupsKey(body.projectId) }),
			});
		},
	},
	updateGroup: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; description?: string | null }) =>
					triggersService.updateGroup(data.id, { description: data.description }),
				onSuccess: () => qc.invalidateQueries({ queryKey: groupsKey(projectId) }),
			});
		},
	},
	deleteGroup: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; options?: DeleteGroupOptions }) =>
					triggersService.deleteGroup(data.id, data.options),
				// its triggers were moved or deleted with it
				onSuccess: () =>
					Promise.all([
						qc.invalidateQueries({ queryKey: groupsKey(projectId) }),
						qc.invalidateQueries({ queryKey: LIST_KEY }),
					]),
			});
		},
	},
	schedulePreview: {
		/** Runs while the user types, so a rejected expression is expected — not
		 *  an error worth retrying or surfacing as a failed request. */
		useQuery(schedule: string, timezone: string) {
			return useQuery({
				queryKey: ["triggers", "schedule-preview", schedule, timezone],
				queryFn: () => triggersService.previewSchedule(schedule, timezone),
				enabled: schedule.trim().length > 0,
				retry: false,
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateTriggerBody) => triggersService.create(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	update: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; body: UpdateTriggerBody }) =>
					triggersService.update(data.id, data.body),
				onSuccess: (_result, data) => {
					// the trigger's page seeds its form once from this: a stale copy would undo the save
					qc.removeQueries({ queryKey: detailKey(data.id) });
					return qc.invalidateQueries({ queryKey: LIST_KEY });
				},
			});
		},
	},
	attach: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; workflowId: string }) =>
					triggersService.attachWorkflow(data.id, data.workflowId),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	detach: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; workflowId: string }) =>
					triggersService.detachWorkflow(data.id, data.workflowId),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	remove: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => triggersService.delete(id),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
};
