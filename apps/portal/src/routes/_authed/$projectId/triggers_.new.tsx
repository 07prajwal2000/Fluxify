import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TriggerWizard } from "@/components/triggers/TriggerWizard";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/triggers_/new")({
	head: createRouteHead(
		"New Trigger",
		"Create a trigger and choose the workflow it starts.",
	),
	component: CreateTriggerPage,
});

function CreateTriggerPage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();

	const goBack = () =>
		navigate({ to: "/$projectId/triggers", params: { projectId } });

	return (
		<TriggerWizard
			projectId={projectId}
			onBack={goBack}
			onSuccess={goBack}
		/>
	);
}

