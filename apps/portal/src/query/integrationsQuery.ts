import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type z from "zod";
import { integrationService, type McpOAuthEnv } from "@/services/integrations";

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
		useQuery(projectId: string, enabled = true) {
			return useQuery({
				queryKey: ["integrations", projectId, "basic-list"],
				queryFn: () => integrationService.getBasicList(projectId),
				refetchOnWindowFocus: false,
				enabled: !!projectId && enabled,
			});
		},
	},
	getVariants: {
		useQuery(projectId: string) {
			return useQuery({
				// own key: saving an integration changes no variant, so it need not refetch this
				queryKey: ["integration-variants", projectId],
				queryFn: () => integrationService.getVariants(projectId),
				refetchOnWindowFocus: false,
				staleTime: 5 * 60 * 1000,
				enabled: !!projectId,
			});
		},
	},
	getById: {
		useQuery(projectId: string, id: string) {
			return useQuery({
				queryKey: ["integrations", projectId, "getById", id],
				queryFn: () => (!id || !projectId ? null : integrationService.getById(projectId, id)),
				refetchOnWindowFocus: false,
				enabled: !!projectId && !!id,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: CreateIntegrationType) => integrationService.create(projectId, data),
				onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
			});
		},
	},
	update: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (params: { id: string; data: UpdateIntegrationType }) =>
					integrationService.update(projectId, params.id, params.data),
				onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
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
				mutationFn: (params: {
					group: string;
					variant: string;
					config: unknown;
					signal?: AbortSignal;
				}) =>
					integrationService.testConnection(
						projectId,
						params.group,
						params.variant,
						params.config,
						params.signal,
					),
			});
		},
	},
	testExistingConnection: {
		mutation(projectId: string) {
			return useMutation({
				mutationFn: ({ id, signal }: { id: string; signal?: AbortSignal }) =>
					integrationService.testExistingConnection(projectId, id, undefined, signal),
			});
		},
	},
	testProductionConnection: {
		mutation(projectId: string) {
			return useMutation({
				mutationFn: ({ id, signal }: { id: string; signal?: AbortSignal }) =>
					integrationService.testProductionConnection(projectId, id, undefined, signal),
			});
		},
	},
	connectMcpOAuth: {
		mutation(projectId: string) {
			return useMutation({
				mutationFn: (params: { id: string; env: McpOAuthEnv }) =>
					integrationService.connectMcpOAuth(projectId, params.id, params.env),
			});
		},
	},
	disconnectMcpOAuth: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (params: { id: string; env: McpOAuthEnv }) =>
					integrationService.disconnectMcpOAuth(projectId, params.id, params.env),
				onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
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

/** The variant list from the server, with the lookups the integration pickers need. */
export function useIntegrationCatalog(projectId: string) {
	const query = integrationsQuery.getVariants.useQuery(projectId);
	const groups = query.data;
	return useMemo(() => {
		// a body that is not a list (an error page, a stubbed client) must not take the canvas down
		const list = Array.isArray(groups) ? groups : [];
		const find = (group: string) => list.find((item) => item.group === group);
		const variantMeta = (group: string, variant: string) =>
			find(group)?.variants.find((v) => v.variant === variant);
		return {
			loaded: groups !== undefined,
			isLoading: query.isLoading,
			catalog: list,
			items: list.flatMap((g) => g.variants.map((v) => ({ ...v, group: g.group }))),
			groups: list.map((item) => item.group),
			builtInGroups: list.filter((item) => item.builtIn),
			pluginGroups: list.filter((item) => !item.builtIn),
			variantsOf: (group: string) => find(group)?.variants.map((item) => item.variant) ?? [],
			variantItemsOf: (group: string) => find(group)?.variants ?? [],
			variantMeta,
			/** a plugin variant's icon (a data URL); `group` narrows it when two groups share a variant name */
			iconOf: (variant: string, group?: string) =>
				(group
					? variantMeta(group, variant)
					: list.flatMap((g) => g.variants).find((v) => v.variant === variant)
				)?.icon,
			labelOf: (group: string) => find(group)?.label ?? group,
			pluginOf: (group: string, variant: string) => variantMeta(group, variant)?.plugin,
		};
	}, [groups, query.isLoading]);
}
