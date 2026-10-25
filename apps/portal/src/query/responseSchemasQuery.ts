import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PutResponseSchemaBody, responseSchemasService } from "@/services/responseSchemas";

const listKey = (routeId: string) => ["routes", routeId, "response-schemas"];

/** A schema edit is uncommitted work, so the route's version list (its "uncommitted" flag) is stale too. */
function useRefresh(routeId: string) {
	const qc = useQueryClient();
	return () =>
		Promise.all([
			qc.invalidateQueries({ queryKey: listKey(routeId) }),
			qc.invalidateQueries({ queryKey: ["routes", routeId, "versions"] }),
		]);
}

export const responseSchemasQuery = {
	list: {
		useQuery(routeId: string) {
			return useQuery({
				queryKey: listKey(routeId),
				queryFn: () => responseSchemasService.list(routeId),
				enabled: Boolean(routeId),
				refetchOnWindowFocus: false,
			});
		},
	},
	put: {
		mutation(routeId: string) {
			const refresh = useRefresh(routeId);
			return useMutation({
				mutationFn: (v: { statusCode: number; body: PutResponseSchemaBody }) =>
					responseSchemasService.put(routeId, v.statusCode, v.body),
				onSuccess: refresh,
			});
		},
	},
	remove: {
		mutation(routeId: string) {
			const refresh = useRefresh(routeId);
			return useMutation({
				mutationFn: (statusCode: number) => responseSchemasService.remove(routeId, statusCode),
				onSuccess: refresh,
			});
		},
	},
};
