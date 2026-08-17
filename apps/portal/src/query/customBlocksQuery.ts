import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type { CanvasSavePayload } from "@/services/canvas";
import { customBlocksService } from "@/services/customBlocks";

const key = (projectId: string) => ["custom-blocks", projectId];
const canvasKey = (id: string) => ["custom-blocks", id, "canvas-items"];

export const customBlocksQuery = {
	getAll: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: key(projectId),
				queryFn: () => customBlocksService.getAll(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	canvasItems: {
		useQuery(id: string) {
			return useQuery({
				queryKey: canvasKey(id),
				queryFn: () => customBlocksService.getCanvasItems(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	saveCanvas: {
		mutation(id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (payload: CanvasSavePayload) =>
					customBlocksService.saveCanvasItems(id, payload),
				onSuccess: () => qc.invalidateQueries({ queryKey: canvasKey(id) }),
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof customBlocksService.createRequestSchema>) =>
					customBlocksService.create(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => customBlocksService.delete(id),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	update: {
		mutation(projectId: string, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof customBlocksService.updateRequestSchema>) =>
					customBlocksService.update(id, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
};
