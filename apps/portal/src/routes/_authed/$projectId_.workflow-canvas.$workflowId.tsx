import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbPlayerPlay, TbSettings } from "react-icons/tb";
import { CanvasWorkbench } from "@/components/canvas";
import { WorkflowRunModal } from "@/components/workflows/WorkflowRunModal";
import { WorkflowSettingsModal } from "@/components/workflows/WorkflowSettingsModal";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead } from "@/lib/seo";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";

export const Route = createFileRoute("/_authed/$projectId_/workflow-canvas/$workflowId")({
	head: createRouteHead(
		"Workflow Canvas",
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
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [runOpen, setRunOpen] = useState(false);

	return (
		<>
			<CanvasWorkbench
				title="Workflow canvas"
				enableBlockPicker
				enableSpotlight
				items={workflowsQuery.canvasItems.useQuery(workflowId)}
				compileTarget={{ projectId, resourceType: "workflow", resourceId: workflowId }}
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
