import {
	Button,
	useInputDataTypes,
	useRouteParamSnippets,
	useRouteParamTypes,
	type ValidationSchema,
} from "@fluxify/components";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbSettings } from "react-icons/tb";
import { CanvasWorkbench } from "@/components/canvas";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { RouteSettingsModal } from "@/components/routes/RouteSettingsModal";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { extractPathParams } from "@/components/routes/routeForm";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { createRouteHead } from "@/lib/seo";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	head: createRouteHead("Route Canvas", "Visual canvas workflow editor for API route logic."),
	component: RouteCanvasPage,
});

function RouteCanvasPage() {
	const { projectId, routeId } = Route.useParams();
	const apiBaseUrl = useProjectApiBaseUrl(projectId);
	const save = routesQuery.saveCanvas.mutation(routeId);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// the same gap workflows had: `getRequestBody()` was `any` on a route whose
	// body schema already says what it holds
	const { data: route } = routesQuery.byId.useQuery(routeId);
	useInputDataTypes(route?.bodySchema as ValidationSchema | null);

	const routeParams = useMemo(() => {
		const fromPath = route?.path ? extractPathParams(route.path) : [];
		const fromSchema = (route?.paramsSchema?.properties ?? []).map((p: { key: string }) => p.key);
		return Array.from(new Set([...fromPath, ...fromSchema]));
	}, [route?.path, route?.paramsSchema]);

	const queryParams = useMemo(() => {
		return (route?.querySchema?.properties ?? []).map((p: { key: string }) => p.key);
	}, [route?.querySchema]);

	useRouteParamTypes(routeParams, queryParams);
	useRouteParamSnippets(routeParams, queryParams);

	const items = routesQuery.canvasItems.useQuery(routeId);

	return (
		<>
			<CanvasWorkbench
				title="Route canvas"
				enableBlockPicker
				enablePlayground
				enableSpotlight
				items={items}
				compileTarget={{ projectId, resourceType: "route", resourceId: routeId }}
				playgroundContent={
					<RouteApiPlayground
						key={routeId}
						routeId={routeId}
						baseUrl={apiBaseUrl}
						isFramed={false}
						enableCache
					/>
				}
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
