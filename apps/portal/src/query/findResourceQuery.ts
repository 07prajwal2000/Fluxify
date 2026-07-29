import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { findResourceService } from "@/services/findResource";

export const findResourceQuery = {
	search: {
		/** Drives the @-mention picker. Empty query = no request; the previous
		 *  results stay on screen while the next keystroke resolves. */
		useQuery(projectId: string, q: string) {
			const term = q.trim();
			return useQuery({
				queryKey: ["find-resource", projectId, term],
				queryFn: () => findResourceService.search(projectId, term),
				enabled: Boolean(projectId) && term.length > 0,
				placeholderData: keepPreviousData,
				staleTime: 30_000,
				refetchOnWindowFocus: false,
			});
		},
	},
};
