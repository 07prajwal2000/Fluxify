import { toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { ConversationPage } from "@/components/ai/ConversationPage";
import { createRouteHead } from "@/lib/seo";
import { agentConversationsService } from "@/services/agentConversations";

export const Route = createFileRoute("/_authed/$projectId/ai/$conversationId")({
	head: createRouteHead("AI Conversation", "View AI conversation history and generated responses."),
	beforeLoad: async ({ params }) => {
		try {
			await agentConversationsService.get(params.projectId, params.conversationId);
		} catch (err) {
			if (isRedirect(err)) throw err;
			toast.danger("Conversation not found");
			throw redirect({
				to: "/$projectId/routes",
				params: { projectId: params.projectId },
			});
		}
	},
	component: ConversationPage,
});
