import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvasSavePayload } from "@/services/canvas";
import {
	type CreateSandboxBody,
	sandboxCanvas,
	sandboxesService,
	type UpdateSandboxBody,
} from "@/services/sandboxes";

const listKey = (projectId: string) => ["sandboxes", projectId, "list"];
const byIdKey = (projectId: string, id: string) => ["sandboxes", projectId, id, "by-id"];
const canvasKey = (projectId: string, id: string) => ["sandboxes", projectId, id, "canvas-items"];

export const sandboxesQuery = {
	getAll: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: listKey(projectId),
				queryFn: () => sandboxesService.list(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	byId: {
		useQuery(projectId: string, id: string) {
			return useQuery({
				queryKey: byIdKey(projectId, id),
				queryFn: () => sandboxesService.getById(projectId, id),
				enabled: Boolean(projectId && id),
				refetchOnWindowFocus: false,
			});
		},
	},
	canvasItems: {
		useQuery(projectId: string, id: string) {
			return useQuery({
				queryKey: canvasKey(projectId, id),
				queryFn: () => sandboxCanvas(projectId).getCanvasItems(id),
				enabled: Boolean(projectId && id),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateSandboxBody) => sandboxesService.create(projectId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectId) }),
			});
		},
	},
	update: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { id: string; body: UpdateSandboxBody }) =>
					sandboxesService.update(projectId, data.id, data.body),
				onSuccess: (_result, data) => {
					qc.invalidateQueries({ queryKey: listKey(projectId) });
					qc.invalidateQueries({ queryKey: byIdKey(projectId, data.id) });
				},
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => sandboxesService.delete(projectId, id),
				onSuccess: () => qc.invalidateQueries({ queryKey: listKey(projectId) }),
			});
		},
	},
	run: {
		mutation(projectId: string, id: string) {
			return useMutation({
				mutationFn: (payload: unknown) => sandboxesService.run(projectId, id, payload),
			});
		},
	},
	saveCanvas: {
		mutation(projectId: string, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (payload: CanvasSavePayload) =>
					sandboxCanvas(projectId).saveCanvasItems(id, payload),
				onSuccess: () => qc.invalidateQueries({ queryKey: canvasKey(projectId, id) }),
			});
		},
	},
	/** polled while a sandbox is open, so the banner follows a worker coming up */
	devWorker: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: ["sandboxes", projectId, "dev-worker"],
				queryFn: () => sandboxesService.devWorkerOnline(projectId),
				enabled: Boolean(projectId),
				refetchInterval: 10_000,
				refetchOnWindowFocus: true,
			});
		},
	},
};
