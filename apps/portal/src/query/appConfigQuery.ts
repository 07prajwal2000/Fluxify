import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateAppConfigBody,
	type DeleteBulkAppConfigBody,
	type ListAppConfigQuery,
	type UpdateAppConfigBody,
	appConfigService,
} from "@/services/appConfig";

const key = (projectId: string) => ["app-config", projectId];

export const appConfigQuery = {
	getAll: {
		/** `enabled` lets a caller mount the hook without firing the request —
		 *  the AI chips look a key up only when the chip is an app config. */
		useQuery(
			projectId: string,
			query: ListAppConfigQuery,
			options: { enabled?: boolean } = {},
		) {
			return useQuery({
				queryKey: [...key(projectId), query],
				queryFn: () => appConfigService.getAll(projectId, query),
				refetchOnWindowFocus: false,
				enabled: options.enabled ?? true,
			});
		},
		useInfiniteQuery(projectId: string, query: Omit<ListAppConfigQuery, "page">) {
			return useInfiniteQuery({
				queryKey: [...key(projectId), "infinite", query],
				queryFn: ({ pageParam = 1 }) =>
					appConfigService.getAll(projectId, { ...query, page: pageParam }),
				getNextPageParam: (lastPage) => {
					if (lastPage.pagination && lastPage.pagination.page < lastPage.pagination.totalPages) {
						return lastPage.pagination.page + 1;
					}
					return undefined;
				},
				initialPageParam: 1,
				refetchOnWindowFocus: false,
			});
		},
	},
	getById: {
		useQuery(projectId: string, id: number | string | null | undefined) {
			return useQuery({
				queryKey: [...key(projectId), "detail", id],
				queryFn: () => appConfigService.getById(projectId, id!),
				enabled: !!projectId && !!id,
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
	update: {
		mutation(projectId: string, id: number | string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: UpdateAppConfigBody) =>
					appConfigService.update(projectId, id, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: number | string) => appConfigService.delete(projectId, id),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	deleteBulk: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: DeleteBulkAppConfigBody) =>
					appConfigService.deleteBulk(projectId, body),
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

