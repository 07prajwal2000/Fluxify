import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { type ListAppConfigQuery, appConfigService } from "@/services/appConfig";

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
				mutationFn: (body: z.infer<typeof appConfigService.createRequestBodySchema>) =>
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
};
