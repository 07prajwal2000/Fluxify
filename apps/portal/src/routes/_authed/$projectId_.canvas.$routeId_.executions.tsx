import { Button, CloseButton, Modal, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbPlayerPlay, TbSettings } from "react-icons/tb";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { ExecutionRecordings } from "@/components/recordings/ExecutionRecordings";
import { RouteSettingsModal } from "@/components/routes/RouteSettingsModal";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import { RouteWorkbenchHeader, RouteWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { useCanEditProject } from "@/store/auth";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId_/executions")({
	head: createRouteHead(
		"Route Executions | Routes",
		"Inspect and debug recorded executions for an API route.",
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
	component: RouteExecutionsPage,
});

function RouteExecutionsPage() {
	const { projectId, routeId } = Route.useParams();
	const { data: route } = routesQuery.byId.useQuery(routeId);
	const canEdit = useCanEditProject(projectId);
	const apiBaseUrl = useProjectApiBaseUrl(projectId);
	const [playgroundOpen, setPlaygroundOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const title = route
		? `${route.method.toUpperCase()} ${route.path} | Route Executions`
		: "Route Executions | Routes";
	usePageTitle(title);

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<RouteSwitcher projectId={projectId} routeId={routeId} />
				<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
				<div className="ml-auto flex items-center gap-2">
					<Button variant="outline" onPress={() => setPlaygroundOpen(true)}>
						<TbPlayerPlay size={16} /> API Playground
					</Button>
					<Button variant="outline" onPress={() => setSettingsOpen(true)}>
						<TbSettings size={16} /> Settings
					</Button>
				</div>
			</RouteWorkbenchHeader>

			<main className="min-h-0 flex-1">
				<ExecutionRecordings
					key={routeId}
					projectId={projectId}
					target={{ type: "route", id: routeId }}
					emptyHint="send a request in the API Playground or your HTTP client"
				/>
			</main>

			{playgroundOpen && (
				<Modal isOpen={playgroundOpen} onOpenChange={setPlaygroundOpen}>
					<Modal.Backdrop>
						<Modal.Container placement="center" size="cover" className="p-0">
							<Modal.Dialog
								aria-label="API Playground"
								className="flex h-[min(820px,86vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50"
							>
								<Modal.Header className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4 py-0">
									<Modal.Heading className="text-sm font-semibold">API Playground</Modal.Heading>
									<CloseButton aria-label="Close API Playground" className="ml-auto" />
								</Modal.Header>
								<Modal.Body className="min-h-0 flex-1 p-0">
									<RouteApiPlayground
										key={routeId}
										routeId={routeId}
										baseUrl={apiBaseUrl}
										isFramed={false}
										enableCache
									/>
								</Modal.Body>
							</Modal.Dialog>
						</Modal.Container>
					</Modal.Backdrop>
				</Modal>
			)}

			{settingsOpen && (
				<RouteSettingsModal
					routeId={routeId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
					readOnly={!canEdit}
				/>
			)}
		</div>
	);
}
