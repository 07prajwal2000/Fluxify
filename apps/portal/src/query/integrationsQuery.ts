import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateIntegrationBody,
	integrationsService,
} from "@/services/integrations";

const key = (projectId: string) => ["integrations", projectId, "basic"];

export const integrationsQuery = {
	getBasicList: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: key(projectId),
				queryFn: () => integrationsService.getBasicList(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateIntegrationBody) =>
					integrationsService.create(projectId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => integrationsService.delete(projectId, id),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
};
