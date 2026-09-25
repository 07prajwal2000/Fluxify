import { createFileRoute } from "@tanstack/react-router";
import { AiHome } from "@/components/ai/AiHome";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/ai/")({
	head: createRouteHead(
		"Fluxify AI",
		"Chat with Fluxify AI to generate workflows and answer questions.",
	),
	component: AiIndexPage,
});

function AiIndexPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Fluxify AI"));
	return <AiHome />;
}
