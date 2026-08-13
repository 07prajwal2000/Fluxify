import { createFileRoute } from "@tanstack/react-router";
import { AiHome } from "@/components/ai/AiHome";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/ai/")({
	head: createRouteHead(
		"AI Assistant Chat",
		"Chat with Fluxify AI to generate workflows and answer questions.",
	),
	component: AiHome,
});
