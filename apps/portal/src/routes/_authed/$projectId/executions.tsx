import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/common/ComingSoon";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/executions")({
	head: createRouteHead(
		"Executions",
		"Monitor route execution logs, status, and performance metrics.",
	),
	component: ExecutionsPage,
});

function ExecutionsPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Executions"));
	return <ComingSoon title="Executions" />;
}
