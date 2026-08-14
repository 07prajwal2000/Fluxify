import { createFileRoute } from "@tanstack/react-router";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { CanvasWorkbench } from "@/components/canvas";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	head: createRouteHead("Route Canvas", "Visual canvas workflow editor for API route logic."),
	component: RouteCanvasPage,
});

function RouteCanvasPage() {
	const { routeId } = Route.useParams();
	const save = routesQuery.saveCanvas.mutation(routeId);

	return (
		<CanvasWorkbench
			title="Route canvas"
			enableBlockPicker
			enablePlayground
			items={routesQuery.canvasItems.useQuery(routeId)}
			playgroundContent={<RouteApiPlayground routeId={routeId} baseUrl={import.meta.env.VITE_ROUTE_BASE_URL ?? window.location.origin} isFramed={false} />}
			reload={() => routesService.getCanvasItems(routeId)}
			save={(payload) => save.mutateAsync(payload)}
		/>
	);
}
