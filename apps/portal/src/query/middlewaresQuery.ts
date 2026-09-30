import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { middlewaresService } from "@/services/middlewares";

type UpdateBody = Parameters<typeof middlewaresService.update>[1];
type CreateBody = Parameters<typeof middlewaresService.create>[0];
type RouteBody = Parameters<typeof middlewaresService.setForRoute>[1];

const listKey = (projectId: string) => ["middlewares", projectId];
const itemKey = (id: string) => ["middlewares", "item", id];
const routeKey = (routeId: string) => ["middlewares", "route", routeId];

export const middlewaresQuery = {
	getAll: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: listKey(projectId),
				queryFn: () => middlewaresService.getAll(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	get: {
		useQuery(id: string) {
			return useQuery({
				queryKey: itemKey(id),
				queryFn: () => middlewaresService.get(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: Omit<CreateBody, "projectId">) =>
					middlewaresService.create({ ...body, projectId }),
				onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectId) }),
			});
		},
	},
	update: {
		mutation(projectId: string, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: UpdateBody) => middlewaresService.update(id, body),
				onSuccess: () => {
					qc.invalidateQueries({ queryKey: listKey(projectId) });
					qc.invalidateQueries({ queryKey: itemKey(id) });
				},
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => middlewaresService.delete(id),
				// a route's list shows the name, so every route list is stale too
				onSuccess: () => qc.invalidateQueries({ queryKey: ["middlewares"] }),
			});
		},
	},
	forRoute: {
		useQuery(routeId: string) {
			return useQuery({
				queryKey: routeKey(routeId),
				queryFn: () => middlewaresService.getForRoute(routeId),
				refetchOnWindowFocus: false,
			});
		},
		mutation(routeId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: RouteBody) => middlewaresService.setForRoute(routeId, body),
				// the list page counts routes per middleware, so it is stale too
				onSuccess: () => qc.invalidateQueries({ queryKey: ["middlewares"] }),
			});
		},
	},
};
