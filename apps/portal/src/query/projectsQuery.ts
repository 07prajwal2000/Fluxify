import {
	type GetAllProjectsQueryParams,
	projectsService,
} from "@/services/projects";
import { type QueryClient, useQuery } from "@tanstack/react-query";

export const projectsQuery = {
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
	invalidateAll(queryClient: QueryClient) {
		queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
	},
};
