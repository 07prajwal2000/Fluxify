import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { type ListRoutesQuery, routesService } from "@/services/routes";

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
				refetchOnWindowFocus: false,
			});
		},
	},
	byId: {
		useQuery(routeId: string) {
			return useQuery({
				queryKey: ["routes", routeId, "by-id"],
				queryFn: () => routesService.getById(routeId),
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
};
