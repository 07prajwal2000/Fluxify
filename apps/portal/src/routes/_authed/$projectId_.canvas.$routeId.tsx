import {
	Button,
	toast,
	useInputDataTypes,
	useRouteParamSnippets,
	useRouteParamTypes,
	type ValidationSchema,
} from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbSettings } from "react-icons/tb";
import { CanvasWorkbench } from "@/components/canvas";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { RouteSettingsModal } from "@/components/routes/RouteSettingsModal";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { extractPathParams } from "@/components/routes/routeForm";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	head: createRouteHead(
		"Route Canvas | Routes",
		"Visual canvas workflow editor for API route logic.",
	),
	beforeLoad: async ({ params, context }) => {
		try {
			const route = await context.queryClient.ensureQueryData({
				queryKey: ["routes", params.routeId, "by-id"],
				queryFn: () => routesService.getById(params.routeId),
			});
			if (!route || route.projectId !== params.projectId) {
				toast.danger("Route not found");
				throw redirect({
					to: "/$projectId/routes",
					params: { projectId: params.projectId },
				});
			}
		} catch (err) {
			if (isRedirect(err)) throw err;
			toast.danger("Route not found");
			throw redirect({
				to: "/$projectId/routes",
				params: { projectId: params.projectId },
			});
		}
	},
	component: RouteCanvasPage,
});

function RouteCanvasPage() {
	const { projectId, routeId } = Route.useParams();
	useProjectPackageTypes(projectId);
	const apiBaseUrl = useProjectApiBaseUrl(projectId);
	const save = routesQuery.saveCanvas.mutation(routeId);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// the same gap workflows had: `getRequestBody()` was `any` on a route whose
	// body schema already says what it holds
	const { data: route } = routesQuery.byId.useQuery(routeId);
	const title = route
		? `${route.method.toUpperCase()} ${route.path} | Routes`
		: "Route Canvas | Routes";
	usePageTitle(title);
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
