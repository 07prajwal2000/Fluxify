import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentConversationsService } from "@/services/agentConversations";

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
};
