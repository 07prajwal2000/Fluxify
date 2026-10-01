import { Spinner, toast } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MiddlewareWizard } from "@/components/middlewares/MiddlewareWizard";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/$middlewareId")({
	head: createRouteHead("Middleware", "Edit a middleware's chain of custom blocks."),
	component: MiddlewareEditorPage,
});

function MiddlewareEditorPage() {
	const { projectId, middlewareId } = Route.useParams();
	const navigate = useNavigate();
	const { data, isLoading, isError } = middlewaresQuery.get.useQuery(middlewareId);
	const update = middlewaresQuery.update.mutation(projectId, middlewareId);
	usePageTitle(data ? `${data.name} | Middlewares` : "Middleware");
	const toList = () => navigate({ to: "/$projectId/middlewares", params: { projectId } });

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (isError || !data)
		return <p className="py-16 text-center text-muted">Couldn't load this middleware.</p>;

	return (
		<MiddlewareWizard
			projectId={projectId}
			title={`Edit ${data.name}`}
			description="Changes apply to every route that uses this middleware."
			initial={{ name: data.name, description: data.description ?? "", chain: data.blocks }}
			submitLabel="Save changes"
			isPending={update.isPending}
			onBack={toList}
			onSubmit={({ name, description, chain }) =>
				update.mutate(
					{ name, description: description || null, blocks: chain.map((b) => b.id) },
					{
						onSuccess: () => {
							toast.success("Middleware saved");
							toList();
						},
						onError: (e) => showErrorNotification(e as Error),
					},
				)
			}
		/>
	);
}
