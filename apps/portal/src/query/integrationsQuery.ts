import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type z from "zod";
import { integrationService } from "@/services/integrations";

type CreateIntegrationType = z.infer<typeof integrationService.createRequestSchema>;
type UpdateIntegrationType = z.infer<typeof integrationService.updateRequestSchema>;

export const integrationsQuery = {
	getAll: {
		useQuery(projectId: string, group: string, tags?: string[]) {
			return useQuery({
				queryKey: ["integrations", projectId, group, tags],
				queryFn: () => integrationService.getAll(projectId, group, tags),
				refetchOnWindowFocus: false,
				staleTime: 5 * 60 * 1000,
				enabled: !!projectId,
			});
		},
	},
	getBasicList: {
		useQuery(projectId: string, useForHarness?: boolean) {
			return useQuery({
				queryKey: ["integrations", projectId, "basic-list", useForHarness],
				queryFn: () => integrationService.getBasicList(projectId, useForHarness),
				refetchOnWindowFocus: false,
				enabled: !!projectId,
			});
		},
	},
	getById: {
		useQuery(projectId: string, id: string) {
			return useQuery({
				queryKey: ["integrations", projectId, "getById", id],
				queryFn: () =>
					!id || !projectId ? null : integrationService.getById(projectId, id),
				refetchOnWindowFocus: false,
				enabled: !!projectId && !!id,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: CreateIntegrationType) =>
					integrationService.create(projectId, data),
				onSuccess: () =>
					qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
			});
		},
	},
	update: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (params: { id: string; data: UpdateIntegrationType }) =>
					integrationService.update(projectId, params.id, params.data),
				onSuccess: () =>
					qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => integrationService.delete(projectId, id),
				onSuccess: () => {
					// Refetch the lists only. Excluding getById avoids refetching the
					// just-deleted id (a 404) while its accordion is still collapsing.
					qc.invalidateQueries({
						predicate: (q) =>
							q.queryKey[0] === "integrations" &&
							q.queryKey[1] === projectId &&
							q.queryKey[2] !== "getById",
					});
				},
			});
		},
	},
	testConnection: {
		mutation(projectId: string) {
			return useMutation({
				mutationFn: (params: { group: string; variant: string; config: unknown }) =>
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
		mutation(projectId: string) {
			return useMutation({
				mutationFn: (id: string) =>
					integrationService.testExistingConnection(projectId, id),
			});
		},
	},
	getMetadata: {
		useQuery(projectId: string, integrationId?: string) {
			return useQuery({
				queryKey: ["integrations", projectId, "metadata", integrationId],
				queryFn: async () => {
					if (!projectId || !integrationId) return null;
					try {
						return await integrationService.getMetadata(projectId, integrationId);
					} catch {
						return null;
					}
				},
				refetchOnWindowFocus: false,
				staleTime: 5 * 60 * 1000,
				enabled: Boolean(projectId) && Boolean(integrationId),
				retry: false,
			});
		},
	},
};
