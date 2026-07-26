import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AiLayout } from "@/components/ai/AiLayout";

export const Route = createFileRoute("/_authed/$projectId/ai")({
	component: () => (
		<AiLayout>
			<Outlet />
		</AiLayout>
	),
});
