import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateTriggerBody,
	type ListTriggersQuery,
	type UpdateTriggerBody,
	triggersService,
} from "@/services/triggers";

const LIST_KEY = ["triggers", "list"];
const groupsKey = (projectId: string) => ["triggers", "groups", projectId];

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
