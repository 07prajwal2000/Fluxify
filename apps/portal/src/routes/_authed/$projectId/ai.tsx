import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AiLayout } from "@/components/ai/AiLayout";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/ai")({
	head: createRouteHead(
		"Fluxify AI Assistant",
		"AI-powered assistant for generating workflows, building routes, and automating tasks.",
	),
	component: () => (
		<AiLayout>
			<Outlet />
		</AiLayout>
	),
});
