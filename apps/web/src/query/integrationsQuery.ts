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
		query: (group: string, tags?: string[]) => {
			return useQuery({
				queryKey: ["integrations", group, tags],
				queryFn: () => integrationService.getAll(group, tags),
				refetchOnWindowFocus: false,
			});
		},
		invalidate: (group: string, client: QueryClient, tags?: string[]) => {
			return client.invalidateQueries({
				queryKey: ["integrations", group, tags],
			});
		},
	},
	getById: {
		query: (id: string) => {
			return useQuery({
				queryKey: ["integrations", "getById", id],
				queryFn: () => {
					if (!id) return null;
					return integrationService.getById(id);
				},
				refetchOnWindowFocus: false,
			});
		},
		invalidate: (id: string, client: QueryClient) => {
			return client.invalidateQueries({
				queryKey: ["integrations", "getById", id],
			});
		},
	},
	create: {
		mutation: (client: QueryClient) => {
			return useMutation({
				mutationFn: (data: CreateIntegrationType) =>
					integrationService.create(data),
				onSuccess: () => {
					client.invalidateQueries({
						queryKey: ["integrations"],
					});
				},
			});
		},
	},
	update: {
		mutation: (client: QueryClient) => {
			return useMutation({
				mutationFn: (params: { id: string; data: UpdateIntegrationType }) =>
					integrationService.update(params.id, params.data),
				onSuccess: () => {
					client.invalidateQueries({
						queryKey: ["integrations"],
					});
				},
			});
		},
	},
	delete: {
		mutation: (client: QueryClient) => {
			return useMutation({
				mutationFn: (id: string) => integrationService.delete(id),
				onSuccess: () => {
					client.invalidateQueries({
						queryKey: ["integrations"],
					});
				},
			});
		},
	},
	testConnection: {
		mutation: () => {
			return useMutation({
				mutationFn: (params: { group: string; variant: string; config: any }) =>
					integrationService.testConnection(
						params.group,
						params.variant,
						params.config,
					),
			});
		},
	},
	testExistingConnection: {
		mutation: () => {
			return useMutation({
				mutationFn: (id: string) => {
					if (!id) return Promise.resolve(null);
					return integrationService.testExistingConnection(id);
				},
			});
		},
	},
};
