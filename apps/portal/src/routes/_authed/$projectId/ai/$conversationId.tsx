import { createFileRoute } from "@tanstack/react-router";
import { ConversationPage } from "@/components/ai/ConversationPage";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/ai/$conversationId")({
	head: createRouteHead(
		"AI Conversation",
		"View AI conversation history and generated responses.",
	),
	component: ConversationPage,
});
