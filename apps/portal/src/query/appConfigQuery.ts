import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateAppConfigBody,
	type ListAppConfigQuery,
	appConfigService,
} from "@/services/appConfig";

const key = (projectId: string) => ["app-config", projectId];

export const appConfigQuery = {
	getAll: {
		useQuery(projectId: string, query: ListAppConfigQuery) {
			return useQuery({
				queryKey: [...key(projectId), query],
				queryFn: () => appConfigService.getAll(projectId, query),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateAppConfigBody) =>
					appConfigService.create(projectId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: number) => appConfigService.delete(projectId, id),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	getKeysList: {
		useQuery(projectId: string, search: string) {
			return useQuery({
				queryKey: ["app-config", projectId, "keys", search],
				queryFn: () => appConfigService.getKeysList(projectId, search),
				refetchOnWindowFocus: false,
			});
		},
	},
};
