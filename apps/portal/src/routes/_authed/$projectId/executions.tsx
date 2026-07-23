import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/common/ComingSoon";

export const Route = createFileRoute("/_authed/$projectId/executions")({
	component: () => <ComingSoon title="Executions" />,
});
