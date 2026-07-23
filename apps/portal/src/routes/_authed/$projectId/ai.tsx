import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/common/ComingSoon";

export const Route = createFileRoute("/_authed/$projectId/ai")({
	component: () => <ComingSoon title="Fluxify AI" />,
});
