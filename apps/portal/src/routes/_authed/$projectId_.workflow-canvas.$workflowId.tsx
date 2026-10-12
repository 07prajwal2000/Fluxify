import { toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";
import { CanvasWorkbench } from "@/components/canvas";
import { WorkflowWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { SettingsSplitButton } from "@/components/sandboxes/SettingsSplitButton";
import { CommitControls } from "@/components/versions/CommitControls";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { useTargetSpotlight } from "@/components/versions/useTargetSpotlight";
import { WorkflowRunButton, WorkflowRunModal } from "@/components/workflows/WorkflowRunModal";
import { WorkflowSettingsModal } from "@/components/workflows/WorkflowSettingsModal";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";
import { useCanEditProject } from "@/store/auth";

export const Route = createFileRoute("/_authed/$projectId_/workflow-canvas/$workflowId")({
	head: createRouteHead(
		"Workflow Canvas | Workflows",
		"Design the background workflow that runs on a trigger or by hand.",
	),
	validateSearch: z.object({ block: z.string().optional(), error: z.string().optional() }),
	beforeLoad: async ({ params, context }) => {
		try {
			const workflow = await context.queryClient.ensureQueryData({
				queryKey: ["workflows", params.workflowId, "by-id"],
				queryFn: () => workflowsService.getById(params.workflowId),
			});
			if (!workflow || workflow.projectId !== params.projectId) {
				toast.danger("Workflow not found");
				throw redirect({
					to: "/$projectId/routes",
					params: { projectId: params.projectId },
				});
			}
		} catch (err) {
			if (isRedirect(err)) throw err;
			toast.danger("Workflow not found");
			throw redirect({
				to: "/$projectId/routes",
				params: { projectId: params.projectId },
			});
		}
	},
	component: WorkflowCanvasPage,
});

function WorkflowCanvasPage() {
	const { projectId, workflowId } = Route.useParams();
	const navigate = useNavigate();
	const { block, error } = Route.useSearch();
	useProjectPackageTypes(projectId);
	const save = workflowsQuery.saveCanvas.mutation(workflowId);
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	const title = workflow?.name ? `${workflow.name} | Workflows` : "Workflow Canvas | Workflows";
	usePageTitle(title);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [runOpen, setRunOpen] = useState(false);
	const canEdit = useCanEditProject(projectId);

	// the canvas command palette's own actions for this target (#739)
	const spotlight = useTargetSpotlight({
		kind: "workflow",
		id: workflowId,
		projectId,
		name: workflow?.name || "Untitled",
		goToHistory: () =>
			navigate({
				to: "/$projectId/workflow-canvas/$workflowId/versions",
				params: { projectId, workflowId },
			}),
		openSandbox: (sandboxId) =>
			navigate({ to: "/$projectId/sandbox-canvas/$sandboxId", params: { projectId, sandboxId } }),
	});

	return (
		<>
			<CanvasWorkbench
				title="Workflow canvas"
				enableBlockPicker
				enableSpotlight
				focusBlock={block ? { blockId: block, error } : undefined}
				readOnly={!canEdit}
				items={workflowsQuery.canvasItems.useQuery(workflowId)}
				spotlightCommands={spotlight.commands}
				compileTarget={{ projectId, resourceType: "workflow", resourceId: workflowId }}
				reload={() => workflowsService.getCanvasItems(workflowId)}
				getRevision={() => workflowsService.getCanvasRevision(workflowId)}
				save={(payload) => save.mutateAsync(payload)}
				headerLeft={
					<>
						<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />
						<WorkflowWorkbenchTabs projectId={projectId} workflowId={workflowId} />
					</>
				}
				headerActions={(canvas) => (
					<>
						<ProductionChip kind="workflow" id={workflowId} projectId={projectId} />
						<CommitControls
							kind="workflow"
							id={workflowId}
							projectId={projectId}
							canvas={canvas}
							onOpenHistory={() =>
								navigate({
									to: "/$projectId/workflow-canvas/$workflowId/versions",
									params: { projectId, workflowId },
								})
							}
						/>
						<WorkflowRunButton
							projectId={projectId}
							active={!!workflow?.active}
							onPress={() => setRunOpen(true)}
						/>
						<SettingsSplitButton
							projectId={projectId}
							source={{ kind: "workflow", id: workflowId, name: workflow?.name || "Untitled" }}
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
			{/* mounted only while open: each form seeds its state from the loaded workflow */}
			{settingsOpen && (
				<WorkflowSettingsModal
					workflowId={workflowId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
					readOnly={!canEdit}
				/>
			)}
			{runOpen && (
				<WorkflowRunModal
					workflowId={workflowId}
					name={workflow?.name ?? "Untitled"}
					isOpen={runOpen}
					onOpenChange={setRunOpen}
				/>
			)}
			{spotlight.dialogs}
		</>
	);
}
