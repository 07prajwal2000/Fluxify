import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AiLayout } from "@/components/ai/AiLayout";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/ai")({
	head: createRouteHead(
		"Fluxify AI",
		"AI-powered assistant for generating workflows, building routes, and automating tasks.",
	),
	component: AiRouteLayout,
});

function AiRouteLayout() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Fluxify AI"));

	return (
		<AiLayout>
			<Outlet />
		</AiLayout>
	);
}
