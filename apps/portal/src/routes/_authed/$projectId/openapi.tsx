import { ApiReferenceReact } from "@scalar/api-reference-react";
import { createFileRoute } from "@tanstack/react-router";
import "@scalar/api-reference-react/style.css";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/openapi")({
	head: createRouteHead(
		"OpenAPI Docs",
		"Interactive OpenAPI specification and API reference documentation.",
	),
	component: OpenApiPage,
});

function OpenApiPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "OpenAPI Docs"));
	const specUrl = `/_/admin/api/v1/routes/${projectId}/openapi.json`;

	return (
		<div className="-m-6 h-[calc(100vh-3.25rem)] overflow-auto">
			<ApiReferenceReact
				configuration={{
					spec: { url: specUrl },
					theme: "default",
					hideModels: true,
					hideDownloadButton: true,
					telemetry: false,
					hideClientButton: true,
				}}
			/>
		</div>
	);
}
