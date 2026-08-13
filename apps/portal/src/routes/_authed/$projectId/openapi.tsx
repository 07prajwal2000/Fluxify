import { createFileRoute } from "@tanstack/react-router";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/openapi")({
	head: createRouteHead(
		"API Documentation (OpenAPI)",
		"Interactive OpenAPI specification and API reference documentation.",
	),
	component: OpenApiPage,
});

function OpenApiPage() {
	const { projectId } = Route.useParams();
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
