import { integrationService } from "@/services/integrations";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import z from "zod";

type CreateIntegrationType = z.infer<
	typeof integrationService.createRequestSchema
>;
type UpdateIntegrationType = z.infer<
	typeof integrationService.updateRequestSchema
>;

export const integrationsQuery = {
	getAll: {
		query: (projectId: string, group: string, tags?: string[]) => {
			return useQuery({
				queryKey: ["integrations", projectId, group, tags],
				queryFn: () => integrationService.getAll(projectId, group, tags),
				refetchOnWindowFocus: false,
				staleTime: 5 * 60 * 1000,
				enabled: !!projectId,
			});
		},
		invalidate: (
			projectId: string,
			group: string,
			client: QueryClient,
			tags?: string[],
		) => {
			return client.invalidateQueries({
				queryKey: ["integrations", projectId, group, tags],
			});
		},
	},
	getBasicList: {
		query: (projectId: string) => {
			return useQuery({
				queryKey: ["integrations", projectId, "basic-list"],
				queryFn: () => integrationService.getBasicList(projectId),
				refetchOnWindowFocus: false,
				enabled: !!projectId,
			});
		},
		invalidate: (projectId: string, client: QueryClient) => {
			return client.invalidateQueries({
				queryKey: ["integrations", projectId, "basic-list"],
			});
		},
	},
	getById: {
		query: (projectId: string, id: string) => {
			return useQuery({
				queryKey: ["integrations", projectId, "getById", id],
				queryFn: () => {
					if (!id || !projectId) return null;
					return integrationService.getById(projectId, id);
				},
				refetchOnWindowFocus: false,
				enabled: !!projectId && !!id,
			});
		},
		invalidate: (projectId: string, id: string, client: QueryClient) => {
			return client.invalidateQueries({
				queryKey: ["integrations", projectId, "getById", id],
			});
		},
	},
	create: {
		mutation: (projectId: string, client: QueryClient) => {
			return useMutation({
				mutationFn: (data: CreateIntegrationType) =>
					integrationService.create(projectId, data),
				onSuccess: () => {
					client.invalidateQueries({
						queryKey: ["integrations", projectId],
					});
				},
			});
		},
	},
	update: {
		mutation: (projectId: string, client: QueryClient) => {
			return useMutation({
				mutationFn: (params: { id: string; data: UpdateIntegrationType }) =>
					integrationService.update(projectId, params.id, params.data),
				onSuccess: () => {
					client.invalidateQueries({
						queryKey: ["integrations", projectId],
					});
				},
			});
		},
	},
	delete: {
		mutation: (projectId: string, client: QueryClient) => {
			return useMutation({
				mutationFn: (id: string) => integrationService.delete(projectId, id),
				onSuccess: () => {
					client.invalidateQueries({
						queryKey: ["integrations", projectId],
					});
				},
			});
		},
	},
	testConnection: {
		mutation: (projectId: string) => {
			return useMutation({
				mutationFn: (params: { group: string; variant: string; config: any }) =>
					integrationService.testConnection(
						projectId,
						params.group,
						params.variant,
						params.config,
					),
			});
		},
	},
	testExistingConnection: {
		mutation: (projectId: string) => {
			return useMutation({
				mutationFn: (id: string) => {
					if (!id || !projectId) return Promise.resolve(null);
					return integrationService.testExistingConnection(projectId, id);
				},
			});
		},
	},
};
