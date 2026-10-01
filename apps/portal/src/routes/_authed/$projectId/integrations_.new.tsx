import { Button } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TbArrowLeft } from "react-icons/tb";
import { z } from "zod";
import { IntegrationOnboardingForm } from "@/components/integrations/IntegrationOnboardingForm";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/integrations_/new")({
	validateSearch: z.object({
		group: z.string().optional(),
		variant: z.string().optional(),
	}),
	head: createRouteHead("New Integration", "Connect a database, AI model, queue or other service."),
	component: CreateIntegrationPage,
});

function CreateIntegrationPage() {
	const { projectId } = Route.useParams();
	const { group, variant } = Route.useSearch();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "New Integration"));
	const navigate = useNavigate();

	return (
		<div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5">
			<div className="flex shrink-0 items-center gap-3">
				<Button
					isIconOnly
					variant="ghost"
					aria-label="Back to integrations"
					onPress={() =>
						navigate({ to: "/$projectId/integrations", params: { projectId }, search: { group } })
					}
				>
					<TbArrowLeft size={18} />
				</Button>
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Connect an integration</h1>
					<p className="text-xs text-muted">
						Pick a service and add the details Fluxify needs to reach it.
					</p>
				</div>
			</div>

			<IntegrationOnboardingForm
				key={`${group}:${variant}`}
				projectId={projectId}
				group={group}
				variant={variant}
				onSelect={(g, v) =>
					navigate({ to: ".", search: { group: g || undefined, variant: v || undefined } })
				}
				onSaved={({ id }) =>
					navigate({
						to: "/$projectId/integrations/$integrationId",
						params: { projectId, integrationId: id },
					})
				}
			/>
		</div>
	);
}
