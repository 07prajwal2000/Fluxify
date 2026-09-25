import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { type GetAllProjectsQueryParams, projectsService } from "@/services/projects";

export const projectsQuery = {
	create: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof projectsService.createRequestBodySchema>) =>
					projectsService.create(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", "list"] }),
			});
		},
	},
	getAll: {
		useQuery(query: GetAllProjectsQueryParams) {
			return useQuery({
				queryKey: ["projects", "list", query],
				queryFn: () => projectsService.getAll(query),
				refetchOnWindowFocus: false,
			});
		},
		invalidate(query: GetAllProjectsQueryParams, queryClient: QueryClient) {
			queryClient.invalidateQueries({ queryKey: ["projects", "list", query] });
		},
	},
	byId: {
		useQuery(id: string) {
			return useQuery({
				queryKey: ["projects", id, "by-id"],
				queryFn: () => projectsService.getById(id),
				enabled: Boolean(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	invalidateAll(queryClient: QueryClient) {
		queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
	},
};
