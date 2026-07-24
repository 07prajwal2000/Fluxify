import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { customBlocksService } from "@/services/customBlocks";

const key = (projectId: string) => ["custom-blocks", projectId];

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
};
