import {
	toast,
	useInputDataTypes,
	useRouteParamSnippets,
	useRouteParamTypes,
	type ValidationSchema,
} from "@fluxify/components";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import z from "zod";
import { CanvasWorkbench } from "@/components/canvas";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { RouteSettingsModal } from "@/components/routes/RouteSettingsModal";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { extractPathParams } from "@/components/routes/routeForm";
import { SettingsSplitButton } from "@/components/sandboxes/SettingsSplitButton";
import { CommitControls } from "@/components/versions/CommitControls";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { useTargetSpotlight } from "@/components/versions/useTargetSpotlight";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { useCanEditProject } from "@/store/auth";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	head: createRouteHead(
		"Route Canvas | Routes",
		"Visual canvas workflow editor for API route logic.",
	),
	validateSearch: z.object({ block: z.string().optional(), error: z.string().optional() }),
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
	const navigate = useNavigate();
	const { block, error } = Route.useSearch();
	useProjectPackageTypes(projectId);
	const save = routesQuery.saveCanvas.mutation(routeId);
	const canEdit = useCanEditProject(projectId);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// the same gap workflows had: `getRequestBody()` was `any` on a route whose
	// body schema already says what it holds
	const { data: route } = routesQuery.byId.useQuery(routeId);
	const title = route
		? `${route.method.toUpperCase()} ${route.path} | Routes`
		: "Route Canvas | Routes";
	usePageTitle(title);
	useInputDataTypes(route?.bodySchema as ValidationSchema | null, route?.bodyMode);

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

	// the canvas command palette's own actions for this target (#739)
	const spotlight = useTargetSpotlight();

	return (
		<>
			<CanvasWorkbench
				title="Route canvas"
				enableBlockPicker
				enablePlayground
				enableSpotlight
				focusBlock={block ? { blockId: block, error } : undefined}
				readOnly={!canEdit}
				items={items}
				spotlightCommands={spotlight.commands}
				compileTarget={{ projectId, resourceType: "route", resourceId: routeId }}
				playgroundContent={
					<RouteApiPlayground key={routeId} routeId={routeId} isFramed={false} enableCache />
				}
				reload={() => routesService.getCanvasItems(routeId)}
				getRevision={() => routesService.getCanvasRevision(routeId)}
				save={(payload) => save.mutateAsync(payload)}
				headerLeft={
					<>
						<RouteSwitcher projectId={projectId} routeId={routeId} />
						<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
					</>
				}
				headerActions={(canvas) => (
					<>
						<ProductionChip kind="route" id={routeId} projectId={projectId} />
						<CommitControls
							kind="route"
							id={routeId}
							projectId={projectId}
							canvas={canvas}
							onOpenHistory={() =>
								navigate({
									to: "/$projectId/canvas/$routeId/versions",
									params: { projectId, routeId },
								})
							}
						/>
						<SettingsSplitButton
							projectId={projectId}
							source={{
								kind: "route",
								id: routeId,
								name: route?.name || `${route?.method.toUpperCase()} ${route?.path}`,
							}}
							onOpenSettings={() => setSettingsOpen(true)}
							onOpenSandbox={(sandboxId) =>
								navigate({
									to: "/$projectId/sandbox-canvas/$sandboxId",
									params: { projectId, sandboxId },
								})
							}
						/>
					</>
				)}
			/>
			{/* mounted only while open: the form seeds its state from the loaded route */}
			{settingsOpen && (
				<RouteSettingsModal
					routeId={routeId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
					readOnly={!canEdit}
				/>
			)}
			{spotlight.dialogs}
		</>
	);
}
