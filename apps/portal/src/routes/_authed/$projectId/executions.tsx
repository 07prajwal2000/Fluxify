import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/common/ComingSoon";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/executions")({
	head: createRouteHead(
		"Route Executions & Audit Logs",
		"Monitor route execution logs, status, and performance metrics.",
	),
	component: () => <ComingSoon title="Executions" />,
});
