import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@fluxify/components";
import { TbSettings } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { CanvasWorkbench } from "@/components/canvas";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { RouteSettingsModal } from "@/components/routes/RouteSettingsModal";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	head: createRouteHead("Route Canvas", "Visual canvas workflow editor for API route logic."),
	component: RouteCanvasPage,
});

function RouteCanvasPage() {
	const { projectId, routeId } = Route.useParams();
	const save = routesQuery.saveCanvas.mutation(routeId);
	const [settingsOpen, setSettingsOpen] = useState(false);

	return (
		<>
			<CanvasWorkbench
				title="Route canvas"
				enableBlockPicker
				enablePlayground
				items={routesQuery.canvasItems.useQuery(routeId)}
				playgroundContent={<RouteApiPlayground routeId={routeId} baseUrl={import.meta.env.VITE_ROUTE_BASE_URL ?? window.location.origin} isFramed={false} />}
				reload={() => routesService.getCanvasItems(routeId)}
				save={(payload) => save.mutateAsync(payload)}
				headerLeft={
					<>
						<RouteSwitcher projectId={projectId} routeId={routeId} />
						<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
					</>
				}
				headerActions={
					<Button variant="outline" onPress={() => setSettingsOpen(true)}>
						<TbSettings size={16} /> Settings
					</Button>
				}
			/>
			{/* mounted only while open: the form seeds its state from the loaded route */}
			{settingsOpen && (
				<RouteSettingsModal
					routeId={routeId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
				/>
			)}
		</>
	);
}
