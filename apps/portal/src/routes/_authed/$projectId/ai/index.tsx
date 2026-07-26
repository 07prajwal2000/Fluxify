import { createFileRoute } from "@tanstack/react-router";
import { AiHome } from "@/components/ai/AiHome";

export const Route = createFileRoute("/_authed/$projectId/ai/")({
	component: AiHome,
});
