import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type AuditFilters, auditLogsService } from "@/services/auditLogs";

const KEY = ["audit-logs"];

export const auditLogsQuery = {
	list: {
		/** newest first; `fetchNextPage` loads the next page */
		useInfiniteQuery(filters: AuditFilters) {
			return useInfiniteQuery({
				queryKey: [...KEY, "list", filters],
				queryFn: ({ pageParam }) => auditLogsService.list(filters, pageParam),
				initialPageParam: undefined as string | undefined,
				getNextPageParam: (last) => last.nextCursor ?? undefined,
				refetchOnWindowFocus: false,
			});
		},
	},
	filters: {
		useQuery() {
			return useQuery({
				queryKey: [...KEY, "filters"],
				queryFn: () => auditLogsService.filters(),
				refetchOnWindowFocus: false,
			});
		},
	},
};
