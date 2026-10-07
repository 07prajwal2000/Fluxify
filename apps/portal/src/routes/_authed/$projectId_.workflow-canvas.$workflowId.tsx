import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbHistory, TbSettings } from "react-icons/tb";
import { CanvasWorkbench } from "@/components/canvas";
import { WorkflowRecordingsModal } from "@/components/recordings/ExecutionRecordings";
import { WorkflowWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
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
	useProjectPackageTypes(projectId);
	const save = workflowsQuery.saveCanvas.mutation(workflowId);
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	const title = workflow?.name ? `${workflow.name} | Workflows` : "Workflow Canvas | Workflows";
	usePageTitle(title);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [runOpen, setRunOpen] = useState(false);
	const [recordingsOpen, setRecordingsOpen] = useState(false);
	const canEdit = useCanEditProject(projectId);

	return (
		<>
			<CanvasWorkbench
				title="Workflow canvas"
				enableBlockPicker
				enableSpotlight
				readOnly={!canEdit}
				items={workflowsQuery.canvasItems.useQuery(workflowId)}
				compileTarget={{ projectId, resourceType: "workflow", resourceId: workflowId }}
				reload={() => workflowsService.getCanvasItems(workflowId)}
				getVersion={() => workflowsService.getCanvasVersion(workflowId)}
				save={(payload) => save.mutateAsync(payload)}
				headerLeft={
					<>
						<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />
						<WorkflowWorkbenchTabs projectId={projectId} workflowId={workflowId} />
					</>
				}
				headerActions={
					<>
						<WorkflowRunButton
							projectId={projectId}
							active={!!workflow?.active}
							onPress={() => setRunOpen(true)}
						/>
						{/* recordings hold unredacted payloads: creators only, as the server enforces */}
						{canEdit && (
							<Button variant="outline" onPress={() => setRecordingsOpen(true)}>
								<TbHistory size={16} /> Track Execution
							</Button>
						)}
						<Button variant="outline" onPress={() => setSettingsOpen(true)}>
							<TbSettings size={16} /> Settings
						</Button>
					</>
				}
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
			{recordingsOpen && (
				<WorkflowRecordingsModal
					projectId={projectId}
					workflowId={workflowId}
					isOpen={recordingsOpen}
					onOpenChange={setRecordingsOpen}
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
		</>
	);
}
