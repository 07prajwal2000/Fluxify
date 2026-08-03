import { createFileRoute } from "@tanstack/react-router";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { CanvasWorkbench } from "@/components/canvas";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	component: RouteCanvasPage,
});

function RouteCanvasPage() {
	const { routeId } = Route.useParams();
	const save = routesQuery.saveCanvas.mutation(routeId);

	return (
		<CanvasWorkbench
			title="Route canvas"
			items={routesQuery.canvasItems.useQuery(routeId)}
			reload={() => routesService.getCanvasItems(routeId)}
			save={(payload) => save.mutateAsync(payload)}
		/>
	);
}
