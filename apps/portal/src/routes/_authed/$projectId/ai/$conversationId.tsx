import { createFileRoute } from "@tanstack/react-router";
import { ConversationPage } from "@/components/ai/ConversationPage";

export const Route = createFileRoute("/_authed/$projectId/ai/$conversationId")({
	component: ConversationPage,
});
