import { toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchHeader, RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { VersionHistory } from "@/components/versions/VersionHistory";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId_/versions")({
	head: createRouteHead(
		"Route Versions | Routes",
		"Look back through the saved versions of an API route and bring one back.",
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
	component: RouteVersionsPage,
});

function RouteVersionsPage() {
	const { projectId, routeId } = Route.useParams();
	const navigate = Route.useNavigate();
	const { data: route } = routesQuery.byId.useQuery(routeId);
	usePageTitle(
		route ? `${route.method.toUpperCase()} ${route.path} | Versions` : "Route Versions | Routes",
	);

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<RouteSwitcher projectId={projectId} routeId={routeId} />
				<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
			</RouteWorkbenchHeader>
			<VersionHistory
				key={routeId}
				kind="route"
				id={routeId}
				projectId={projectId}
				onBackToCanvas={() =>
					navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } })
				}
				onOpenSandbox={(sandboxId) =>
					navigate({
						to: "/$projectId/sandbox-canvas/$sandboxId",
						params: { projectId, sandboxId },
					})
				}
			/>
		</div>
	);
}
