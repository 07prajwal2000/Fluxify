import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { findResourceService } from "@/services/findResource";
import { integrationService } from "@/services/integrations";

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
	getIntegrationMetadata: {
		/** Fetches integration metadata (e.g. database tables and columns) */
		useQuery(projectId: string, integrationId?: string) {
			return useQuery({
				queryKey: ["integrations", projectId, "metadata", integrationId],
				queryFn: async () => {
					if (!projectId || !integrationId) return null;
					try {
						return await integrationService.getMetadata(projectId, integrationId);
					} catch {
						// gracefully ignore metadata loading errors
						return null;
					}
				},
				enabled: Boolean(projectId) && Boolean(integrationId),
				staleTime: 5 * 60 * 1000,
				retry: false,
				refetchOnWindowFocus: false,
			});
		},
	},
};

/**
 * Custom hook to retrieve introspected database tables and columns for an integration.
 * Safely ignores errors and returns empty arrays when metadata is unavailable.
 */
export function useDbMetadata(projectId?: string, connectionId?: string) {
	const { data, isLoading } = findResourceQuery.getIntegrationMetadata.useQuery(
		projectId ?? "",
		connectionId,
	);

	const tables = data?.metadata?.tables ?? [];
	const tableNames = tables.map((t) => t.table);

	const allColumns = useMemo(() => {
		const set = new Set<string>();
		for (const t of tables) {
			for (const c of t.columns ?? []) {
				if (c?.name) set.add(c.name);
			}
		}
		return Array.from(set);
	}, [tables]);

	const getColumnsForTable = useCallback(
		(tableName?: string): string[] => {
			if (!tableName) return allColumns;
			// Strip js: prefix and surrounding quotes e.g. js:'users' -> users
			const clean = tableName
				.replace(/^js:/, "")
				.replace(/^['"`]|['"`]$/g, "")
				.trim()
				.toLowerCase();

			if (!clean) return allColumns;

			// Support exact match, schema.table match, or table without schema match
			const matched = tables.find((item) => {
				const t = item.table.toLowerCase();
				return (
					t === clean ||
					t.endsWith(`.${clean}`) ||
					t.split(".").pop() === clean
				);
			});

			const cols = matched?.columns?.map((c) => c.name).filter(Boolean) ?? [];
			return cols.length > 0 ? cols : allColumns;
		},
		[tables, allColumns],
	);

	return {
		isLoading,
		tables,
		tableNames,
		allColumns,
		getColumnsForTable,
	};
}

