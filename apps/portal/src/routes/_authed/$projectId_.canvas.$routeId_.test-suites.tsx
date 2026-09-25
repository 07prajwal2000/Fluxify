import { toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { TestSuitesWorkbench } from "@/components/testSuites/TestSuitesWorkbench";
import { TestsSpotlight } from "@/components/testSuites/TestsSpotlight";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId_/test-suites")({
	head: createRouteHead(
		"Route Tests | Routes",
		"Create, edit and run test suites for an API route.",
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
	component: TestSuitesPage,
});

function TestSuitesPage() {
	const { projectId, routeId } = Route.useParams();
	const { data: route } = routesQuery.byId.useQuery(routeId);
	const title = route
		? `${route.method.toUpperCase()} ${route.path} | Route Tests`
		: "Route Tests | Routes";
	usePageTitle(title);
	// The workbench owns the topbar: the run controls and the suite count live
	// there alongside the route switcher and the canvas/tests tabs.
	return (
		<div className="flex h-screen w-full flex-col">
			<TestSuitesWorkbench
				projectId={projectId}
				target={{ type: "route", id: routeId }}
				headerLeft={
					<>
						<RouteSwitcher projectId={projectId} routeId={routeId} />
						<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
					</>
				}
			/>
			<TestsSpotlight />
		</div>
	);
}
