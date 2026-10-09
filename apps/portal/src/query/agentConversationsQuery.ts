import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentConversationsService, type ConversationPatch } from "@/services/agentConversations";

/** Every agent conversation query of a project; rename/pin/archive/delete invalidate it too. */
export const agentConversationsKey = (projectId: string) => ["agent-conversations", projectId];

export const agentConversationsQuery = {
	list: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: [...agentConversationsKey(projectId), "list"],
				queryFn: () => agentConversationsService.list(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	model: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: [...agentConversationsKey(projectId), "model"],
				queryFn: () => agentConversationsService.model(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	detail: {
		useQuery(projectId: string, conversationId: string) {
			return useQuery({
				queryKey: [...agentConversationsKey(projectId), "detail", conversationId],
				queryFn: () => agentConversationsService.get(projectId, conversationId),
				enabled: Boolean(conversationId),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (title?: string) => agentConversationsService.create(projectId, title),
				onSuccess: () => qc.invalidateQueries({ queryKey: agentConversationsKey(projectId) }),
			});
		},
	},
	/** Rename, pin and archive of one conversation. */
	update: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (patch: ConversationPatch) =>
					agentConversationsService.update(projectId, conversationId, patch),
				onSuccess: () => qc.invalidateQueries({ queryKey: agentConversationsKey(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (conversationId: string) =>
					agentConversationsService.remove(projectId, conversationId),
				onSuccess: () => qc.invalidateQueries({ queryKey: agentConversationsKey(projectId) }),
			});
		},
	},
};
