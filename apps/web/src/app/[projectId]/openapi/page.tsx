"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { useParams } from "next/navigation";
import { Suspense } from "react";

function OpenApiPageContent() {
	const { projectId } = useParams<{ projectId: string }>();

	if (!projectId) {
		return <div>Missing projectId parameter</div>;
	}

	const specUrl = `/_/admin/api/v1/routes/${projectId}/openapi.json`;

	return (
		<ApiReferenceReact
			configuration={{
				spec: { url: specUrl },
				theme: "default",
				darkMode: false,
				hideModels: true,
				hideDownloadButton: true,
				mcp: { disabled: true },
				agent: { disabled: true },
				proxyUrl: "",
				telemetry: false,
				showDeveloperTools: "never",
				hideClientButton: true,
			}}
		/>
	);
}

export default function OpenApiPage() {
	return (
		<Suspense fallback={<div>Loading...</div>}>
			<OpenApiPageContent />
		</Suspense>
	);
}
