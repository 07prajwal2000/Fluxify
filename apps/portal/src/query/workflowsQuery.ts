import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvasSavePayload } from "@/services/canvas";
import {
	type CreateWorkflowBody,
	type ListWorkflowsQuery,
	type UpdateWorkflowBody,
	workflowsService,
} from "@/services/workflows";

const LIST_KEY = ["workflows", "list"];
const byIdKey = (id: string) => ["workflows", id, "by-id"];

export const workflowsQuery = {
	getAll: {
		useQuery(query: ListWorkflowsQuery) {
			return useQuery({
				queryKey: [...LIST_KEY, query],
				queryFn: () => workflowsService.getAll(query),
				refetchOnWindowFocus: false,
			});
		},
	},
	byId: {
		useQuery(id: string) {
			return useQuery({
				queryKey: byIdKey(id),
				queryFn: () => workflowsService.getById(id),
				enabled: Boolean(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	canvasItems: {
		useQuery(id: string) {
			return useQuery({
				queryKey: ["workflows", id, "canvas-items"],
				queryFn: () => workflowsService.getCanvasItems(id),
				enabled: Boolean(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateWorkflowBody) => workflowsService.create(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	update: {
		mutation(id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: UpdateWorkflowBody) => workflowsService.update(id, body),
				onSuccess: () => {
					qc.invalidateQueries({ queryKey: LIST_KEY });
					qc.invalidateQueries({ queryKey: byIdKey(id) });
				},
			});
		},
	},
	toggleActive: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; active: boolean }) =>
					workflowsService.update(data.id, { active: data.active }),
				onSuccess: (_result, data) => {
					qc.invalidateQueries({ queryKey: LIST_KEY });
					qc.invalidateQueries({ queryKey: byIdKey(data.id) });
				},
			});
		},
	},
	remove: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => workflowsService.delete(id),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	run: {
		mutation(id: string) {
			return useMutation({
				mutationFn: (payload: unknown) => workflowsService.run(id, payload),
			});
		},
	},
	saveCanvas: {
		mutation(id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (payload: CanvasSavePayload) =>
					workflowsService.saveCanvasItems(id, payload),
				onSuccess: () =>
					qc.invalidateQueries({ queryKey: ["workflows", id, "canvas-items"] }),
			});
		},
	},
};
