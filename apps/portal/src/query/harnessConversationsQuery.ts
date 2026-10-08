import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { harnessConversationsService } from "@/services/harnessConversations";
import { agentConversationsKey as key } from "./agentConversationsQuery";

/** Rename, pin/archive and delete still go through the conversation endpoints the agent shares. */
export const harnessConversationsQuery = {
	update: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof harnessConversationsService.updateRequestBodySchema>) =>
					harnessConversationsService.update(projectId, conversationId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (conversationId: string) =>
					harnessConversationsService.delete(projectId, conversationId),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	action: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: z.infer<typeof harnessConversationsService.actionRequestBodySchema>) =>
					harnessConversationsService.action(projectId, conversationId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
};
