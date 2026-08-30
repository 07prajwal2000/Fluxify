import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/common/ComingSoon";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/triggers")({
	head: createRouteHead(
		"Triggers",
		"Start workflows on a schedule or an event instead of by hand.",
	),
	component: () => <ComingSoon title="Triggers" />,
});
