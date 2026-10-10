import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SandboxList } from "@/components/sandboxes/SandboxList";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/sandboxes")({
	head: createRouteHead(
		"Sandboxes",
		"Your private scratch canvases: try blocks and run them on development data.",
	),
	component: SandboxesPage,
});

function SandboxesPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Sandboxes"));
	const navigate = useNavigate();

	return (
		<SandboxList
			projectId={projectId}
			onOpen={(sandboxId) =>
				navigate({ to: "/$projectId/sandbox-canvas/$sandboxId", params: { projectId, sandboxId } })
			}
		/>
	);
}
