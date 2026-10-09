import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	agentConversationsService,
	type CanvasPreviewBody,
	type ConversationPatch,
} from "@/services/agentConversations";

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
	/** What a tool call targets or would do, read when its card opens. Never refetched: the card describes the call as it was asked. */
	preview: {
		canvas: {
			useQuery(projectId: string, body: CanvasPreviewBody, enabled = true) {
				return useQuery({
					queryKey: [...agentConversationsKey(projectId), "canvas-preview", body],
					queryFn: () => agentConversationsService.canvasPreview(projectId, body),
					enabled,
					retry: false,
					staleTime: Number.POSITIVE_INFINITY,
					refetchOnWindowFocus: false,
				});
			},
		},
		resource: {
			useQuery(projectId: string, tool: string, input: Record<string, unknown>, enabled = true) {
				return useQuery({
					queryKey: [...agentConversationsKey(projectId), "resource-preview", tool, input],
					queryFn: () => agentConversationsService.resourcePreview(projectId, tool, input),
					enabled,
					retry: false,
					staleTime: 60_000,
					refetchOnWindowFocus: false,
				});
			},
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
