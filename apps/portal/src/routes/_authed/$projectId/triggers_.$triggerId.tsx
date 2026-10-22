import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TriggerPage } from "@/components/triggers/TriggerPage";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";
import { triggersQuery } from "@/query/triggersQuery";

export const Route = createFileRoute("/_authed/$projectId/triggers_/$triggerId")({
	head: createRouteHead("Trigger", "View and edit a trigger and the workflow it starts."),
	component: TriggerDetailsPage,
});

function TriggerDetailsPage() {
	const { projectId, triggerId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	const { data: trigger } = triggersQuery.byId.useQuery(triggerId);
	usePageTitle(formatProjectTitle(project?.name, trigger?.name ?? "Trigger"));
	const navigate = useNavigate();

	return (
		<TriggerPage
			projectId={projectId}
			triggerId={triggerId}
			onDone={() => navigate({ to: "/$projectId/triggers", params: { projectId } })}
		/>
	);
}
