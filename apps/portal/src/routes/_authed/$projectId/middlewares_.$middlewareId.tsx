import { Spinner, toast } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { CanvasHeaderState } from "@/components/canvas/CanvasWorkbench";
import { MiddlewareWizard } from "@/components/middlewares/MiddlewareWizard";
import { RouteWorkbenchHeader } from "@/components/routes/RouteWorkbenchTabs";
import { CommitControls } from "@/components/versions/CommitControls";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { UsedBy } from "@/components/versions/UsedBy";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/$middlewareId")({
	head: createRouteHead("Middleware", "Edit a middleware's chain of custom blocks."),
	component: MiddlewareEditorPage,
});

/** The wizard saves on its own; the header's Commit only sees what the server holds. */
const SERVER_ONLY: CanvasHeaderState = { hasUnsavedChanges: false, saveChanges: async () => true };

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
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<span className="font-medium">{data.name}</span>
				<div className="ml-auto flex items-center gap-2">
					<ProductionChip kind="middleware" id={middlewareId} projectId={projectId} />
					<CommitControls
						kind="middleware"
						id={middlewareId}
						projectId={projectId}
						canvas={SERVER_ONLY}
						onOpenHistory={() =>
							navigate({
								to: "/$projectId/middlewares/$middlewareId/versions",
								params: { projectId, middlewareId },
							})
						}
					/>
				</div>
			</RouteWorkbenchHeader>
			<div className="min-h-0 flex-1 overflow-y-auto p-6">
				<MiddlewareWizard
					projectId={projectId}
					title={`Edit ${data.name}`}
					description="Changes apply to every route that uses this middleware."
					initial={{ name: data.name, description: data.description ?? "", chain: data.blocks }}
					submitLabel="Save changes"
					isPending={update.isPending}
					onBack={toList}
					reviewExtra={
						<section className="mt-2">
							<p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Used by</p>
							<UsedBy kind="middleware" id={middlewareId} projectId={projectId} />
						</section>
					}
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
			</div>
		</div>
	);
}
