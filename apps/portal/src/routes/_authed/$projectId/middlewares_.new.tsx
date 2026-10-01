import { toast } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MiddlewareWizard } from "@/components/middlewares/MiddlewareWizard";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/new")({
	head: createRouteHead("New Middleware", "Create a middleware: a chain of custom blocks."),
	component: CreateMiddlewarePage,
});

function CreateMiddlewarePage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "New Middleware"));
	const navigate = useNavigate();
	const create = middlewaresQuery.create.mutation(projectId);
	const toList = () => navigate({ to: "/$projectId/middlewares", params: { projectId } });

	return (
		<MiddlewareWizard
			projectId={projectId}
			title="Create a middleware"
			description="Steps that run before or after a route, like an API key check or logging."
			initial={{ name: "", description: "", chain: [] }}
			submitLabel="Create middleware"
			isPending={create.isPending}
			onBack={toList}
			onSubmit={({ name, description, chain }) =>
				create.mutate(
					{ name, description: description || undefined, blocks: chain.map((b) => b.id) },
					{
						onSuccess: () => {
							toast.success("Middleware created");
							toList();
						},
						onError: (e) => showErrorNotification(e as Error),
					},
				)
			}
		/>
	);
}
