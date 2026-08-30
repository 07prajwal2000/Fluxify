import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@fluxify/components";
import { TbPlayerPlay, TbSettings } from "react-icons/tb";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";
import { CanvasWorkbench } from "@/components/canvas";
import { WorkflowRunModal } from "@/components/workflows/WorkflowRunModal";
import { WorkflowSettingsModal } from "@/components/workflows/WorkflowSettingsModal";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute(
	"/_authed/$projectId_/workflow-canvas/$workflowId",
)({
	head: createRouteHead(
		"Workflow Canvas",
		"Design the background workflow that runs on a trigger or by hand.",
	),
	component: WorkflowCanvasPage,
});

function WorkflowCanvasPage() {
	const { projectId, workflowId } = Route.useParams();
	const save = workflowsQuery.saveCanvas.mutation(workflowId);
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [runOpen, setRunOpen] = useState(false);

	return (
		<>
			<CanvasWorkbench
				title="Workflow canvas"
				enableBlockPicker
				items={workflowsQuery.canvasItems.useQuery(workflowId)}
				reload={() => workflowsService.getCanvasItems(workflowId)}
				save={(payload) => save.mutateAsync(payload)}
				headerLeft={<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />}
				headerActions={
					<>
						<Button
							variant="outline"
							// nothing to run until it is published to a worker
							isDisabled={!workflow?.active}
							onPress={() => setRunOpen(true)}
						>
							<TbPlayerPlay size={16} /> Run
						</Button>
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
