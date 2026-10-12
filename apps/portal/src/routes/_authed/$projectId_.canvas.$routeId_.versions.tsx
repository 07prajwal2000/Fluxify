import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbLayoutSidebarRightCollapse, TbLayoutSidebarRightExpand } from "react-icons/tb";
import { z } from "zod";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchHeader, RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { VersionHistory, type VersionTab } from "@/components/versions/VersionHistory";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId_/versions")({
	head: createRouteHead(
		"Route Versions | Routes",
		"Look back through the saved versions of an API route and bring one back.",
	),
	// the header's Prod chip lands here on the Production tab (#739)
	validateSearch: z.object({
		tab: z.enum(["versions", "production"]).optional().catch(undefined),
	}),
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
	const tab = Route.useSearch().tab ?? "versions";
	const navigate = Route.useNavigate();
	const { data: route } = routesQuery.byId.useQuery(routeId);
	const [settingsOpen, setSettingsOpen] = useState(true);
	usePageTitle(
		route ? `${route.method.toUpperCase()} ${route.path} | Versions` : "Route Versions | Routes",
	);

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<RouteSwitcher projectId={projectId} routeId={routeId} />
				<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
				<div className="ml-auto flex items-center gap-2">
					<ProductionChip kind="route" id={routeId} projectId={projectId} />
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						aria-label={settingsOpen ? "Hide version settings" : "Show version settings"}
						onPress={() => setSettingsOpen((open) => !open)}
					>
						{settingsOpen ? (
							<TbLayoutSidebarRightCollapse size={16} />
						) : (
							<TbLayoutSidebarRightExpand size={16} />
						)}
					</Button>
				</div>
			</RouteWorkbenchHeader>
			<VersionHistory
				key={routeId}
				kind="route"
				id={routeId}
				projectId={projectId}
				tab={tab}
				onTabChange={(next: VersionTab) =>
					navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
				}
				settingsOpen={settingsOpen}
				onBackToCanvas={() =>
					navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } })
				}
				onOpenSandbox={(sandboxId) =>
					navigate({
						to: "/$projectId/sandbox-canvas/$sandboxId",
						params: { projectId, sandboxId },
					})
				}
				onViewRecordings={(versionId) =>
					navigate({
						to: "/$projectId/canvas/$routeId/executions",
						params: { projectId, routeId },
						search: { version: versionId },
					})
				}
			/>
		</div>
	);
}
