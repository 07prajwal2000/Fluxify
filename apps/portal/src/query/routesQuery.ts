import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { Observability } from "@/components/settings/observability";
import {
	type CanvasSavePayload,
	type ListRoutesQuery,
	routesService,
	type UpdateRouteBody,
} from "@/services/routes";

const LIST_KEY = ["routes", "list"];

export const routesQuery = {
	getAll: {
		useQuery(query: ListRoutesQuery) {
			return useQuery({
				queryKey: [...LIST_KEY, query],
				queryFn: () => routesService.getAll(query),
				refetchOnWindowFocus: false,
			});
		},
	},
	canvasItems: {
		useQuery(routeId: string) {
			return useQuery({
				queryKey: ["routes", routeId, "canvas-items"],
				queryFn: () => routesService.getCanvasItems(routeId),
				enabled: Boolean(routeId),
				refetchOnWindowFocus: false,
			});
		},
	},
	byId: {
		useQuery(routeId: string) {
			return useQuery({
				queryKey: ["routes", routeId, "by-id"],
				queryFn: () => routesService.getById(routeId),
				enabled: Boolean(routeId),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof routesService.createRequestSchema>) =>
					routesService.create(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	update: {
		mutation(routeId: string) {
			const qc = useQueryClient();
			return useMutation({
				// The full update takes the definition only; the four recording and
				// tracing switches go through the partial update (#736).
				mutationFn: async ({
					observability,
					...body
				}: UpdateRouteBody & { observability?: Partial<Observability> }) => {
					const saved = await routesService.update(routeId, body);
					if (!observability || Object.keys(observability).length === 0) return saved;
					return routesService.updatePartial(routeId, observability);
				},
				onSuccess: () => {
					qc.invalidateQueries({ queryKey: LIST_KEY });
					qc.invalidateQueries({ queryKey: ["routes", routeId, "by-id"] });
				},
			});
		},
	},
	toggleActive: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; active: boolean }) =>
					routesService.updatePartial(data.id, { active: data.active }),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	remove: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => routesService.delete(id),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	saveCanvas: {
		mutation(routeId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (payload: CanvasSavePayload) => routesService.saveCanvasItems(routeId, payload),
				onSuccess: () =>
					// a saved edit is uncommitted work (#738): the header's Commit reads it from the route
					Promise.all([
						qc.invalidateQueries({ queryKey: ["routes", routeId, "canvas-items"] }),
						qc.invalidateQueries({ queryKey: ["routes", routeId, "by-id"] }),
					]),
			});
		},
	},
};
