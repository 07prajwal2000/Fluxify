import { createFileRoute } from "@tanstack/react-router";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { CanvasWorkbench } from "@/components/canvas";
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
			items={routesQuery.canvasItems.useQuery(routeId)}
			reload={() => routesService.getCanvasItems(routeId)}
			save={(payload) => save.mutateAsync(payload)}
		/>
	);
}
