import { Button, CloseButton, Modal, Spinner } from "@fluxify/components";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbActivity } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { ExecutionRecordings } from "@/components/recordings/ExecutionRecordings";
import { ExecutionTargetHeader } from "@/components/recordings/ExecutionTargetHeader";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { WorkflowRunModal } from "@/components/workflows/WorkflowRunModal";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";
import { routesQuery } from "@/query/routesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { Workflow } from "@/services/workflows";
import type { RouteRow } from "./routes";

export const Route = createFileRoute("/_authed/$projectId/executions")({
	head: createRouteHead(
		"Executions",
		"Monitor route and workflow execution traces, analyze runtime performance, and debug individual spans.",
	),
	validateSearch: (search: Record<string, unknown>) => ({
		targetType: (search.targetType === "workflow"
			? "workflow"
			: search.targetType === "route"
				? "route"
				: undefined) as "route" | "workflow" | undefined,
		targetId: typeof search.targetId === "string" ? search.targetId : undefined,
	}),
	component: ExecutionsPage,
});

function ExecutionsPage() {
	const { projectId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Executions"));
	const apiBaseUrl = useProjectApiBaseUrl(projectId);

	const routesRes = routesQuery.getAll.useQuery({ projectId, page: 1, perPage: 50 });
	const workflowsRes = workflowsQuery.getAll.useQuery({ projectId, page: 1, perPage: 50 });

	const routes = useMemo(() => (routesRes.data?.data ?? []) as RouteRow[], [routesRes.data?.data]);
	const workflows = useMemo(
		() => (workflowsRes.data?.data ?? []) as Workflow[],
		[workflowsRes.data?.data],
	);

	const [playgroundOpen, setPlaygroundOpen] = useState(false);
	const [workflowRunOpen, setWorkflowRunOpen] = useState(false);

	// Determine active target based on search params or auto-selection
	const selectedTarget = useMemo(() => {
		if (search.targetId && search.targetType) {
			const exists =
				search.targetType === "route"
					? routes.some((r) => r.id === search.targetId)
					: workflows.some((w) => w.id === search.targetId);
			if (exists) {
				return { type: search.targetType, id: search.targetId };
			}
		}

		// Priority 1: Target actively recording
		const recordingRoute = routes.find((r) => r.recordExecution);
		if (recordingRoute) return { type: "route" as const, id: recordingRoute.id };
		const recordingWorkflow = workflows.find((w) => w.recordExecution);
		if (recordingWorkflow) return { type: "workflow" as const, id: recordingWorkflow.id };

		// Priority 2: First route or first workflow
		if (routes.length > 0 && routes[0]) return { type: "route" as const, id: routes[0].id };
		if (workflows.length > 0 && workflows[0])
			return { type: "workflow" as const, id: workflows[0].id };

		return null;
	}, [search.targetId, search.targetType, routes, workflows]);

	const targetType = selectedTarget?.type ?? "route";
	const targetId = selectedTarget?.id ?? "";

	const activeRouteRes = routesQuery.byId.useQuery(targetType === "route" ? targetId : "");
	const activeWorkflowRes = workflowsQuery.byId.useQuery(targetType === "workflow" ? targetId : "");

	const mergedRoutes = useMemo(() => {
		if (targetType !== "route" || !activeRouteRes.data) return routes;
		return routes.map((r) =>
			r.id === targetId ? { ...r, recordExecution: activeRouteRes.data.recordExecution } : r,
		);
	}, [routes, activeRouteRes.data, targetType, targetId]);

	const mergedWorkflows = useMemo(() => {
		if (targetType !== "workflow" || !activeWorkflowRes.data) return workflows;
		return workflows.map((w) =>
			w.id === targetId ? { ...w, recordExecution: activeWorkflowRes.data.recordExecution } : w,
		);
	}, [workflows, activeWorkflowRes.data, targetType, targetId]);

	function handleSelectTarget(type: "route" | "workflow", id: string) {
		navigate({
			search: { targetType: type, targetId: id },
		});
	}

	const isLoading = routesRes.isLoading || workflowsRes.isLoading;
	const selectedWorkflow =
		targetType === "workflow" ? workflows.find((w) => w.id === targetId) : null;

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (routes.length === 0 && workflows.length === 0) {
		return (
			<div className="flex flex-col gap-4">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Executions</h1>
					<p className="text-sm text-muted">
						Monitor route and workflow execution traces, analyze runtime performance, and debug
						individual spans.
					</p>
				</div>
				<EmptyState
					icon={<TbActivity size={28} />}
					title="No targets to record"
					description="API routes and background workflows can record execution traces for debugging. Create your first route or workflow to get started."
					action={
						<Button
							variant="primary"
							onPress={() => navigate({ to: "/$projectId/routes/new", params: { projectId } })}
						>
							Create route
						</Button>
					}
				/>
			</div>
		);
	}

	return (
		<div className="flex h-[calc(100vh-3rem)] flex-col gap-4 overflow-hidden">
			<div className="shrink-0">
				<ExecutionTargetHeader
					projectId={projectId}
					targetType={targetType}
					targetId={targetId}
					routes={mergedRoutes}
					workflows={mergedWorkflows}
					onSelectTarget={handleSelectTarget}
					onOpenCanvas={() => {
						if (targetType === "route") {
							navigate({
								to: "/$projectId/canvas/$routeId",
								params: { projectId, routeId: targetId },
							});
						} else {
							navigate({
								to: "/$projectId/workflow-canvas/$workflowId",
								params: { projectId, workflowId: targetId },
							});
						}
					}}
					onOpenPlayground={() => setPlaygroundOpen(true)}
					onOpenRunWorkflow={() => setWorkflowRunOpen(true)}
				/>
			</div>

			{targetId && (
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
					<ExecutionRecordings
						key={`${targetType}:${targetId}`}
						projectId={projectId}
						target={{ type: targetType, id: targetId }}
						emptyHint={
							targetType === "route"
								? "send a request in the API Playground or your HTTP client"
								: "run the workflow with the Run button or its trigger"
						}
					/>
				</div>
			)}

			{playgroundOpen && targetType === "route" && targetId && (
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
										key={targetId}
										routeId={targetId}
										baseUrl={apiBaseUrl}
										isFramed={false}
									/>
								</Modal.Body>
							</Modal.Dialog>
						</Modal.Container>
					</Modal.Backdrop>
				</Modal>
			)}

			{workflowRunOpen && targetType === "workflow" && targetId && (
				<WorkflowRunModal
					workflowId={targetId}
					name={selectedWorkflow?.name ?? "Untitled"}
					isOpen={workflowRunOpen}
					onOpenChange={setWorkflowRunOpen}
				/>
			)}
		</div>
	);
}
