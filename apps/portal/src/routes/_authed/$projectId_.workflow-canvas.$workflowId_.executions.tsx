import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbSettings } from "react-icons/tb";
import { z } from "zod";
import { ExecutionRecordings } from "@/components/recordings/ExecutionRecordings";
import {
	RouteWorkbenchHeader,
	WorkflowWorkbenchTabs,
} from "@/components/routes/RouteWorkbenchTabs";
import { WorkflowRunButton, WorkflowRunModal } from "@/components/workflows/WorkflowRunModal";
import { WorkflowSettingsModal } from "@/components/workflows/WorkflowSettingsModal";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";
import { useCanEditProject } from "@/store/auth";

export const Route = createFileRoute(
	"/_authed/$projectId_/workflow-canvas/$workflowId_/executions",
)({
	head: createRouteHead(
		"Workflow Executions | Workflows",
		"Inspect and debug recorded executions for a workflow.",
	),
	validateSearch: z.object({ open: z.string().optional() }),
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
	component: WorkflowExecutionsPage,
});

function WorkflowExecutionsPage() {
	const { projectId, workflowId } = Route.useParams();
	const { open } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	const canEdit = useCanEditProject(projectId);
	const [runOpen, setRunOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const title = workflow?.name
		? `${workflow.name} | Workflow Executions`
		: "Workflow Executions | Workflows";
	usePageTitle(title);

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />
				<WorkflowWorkbenchTabs projectId={projectId} workflowId={workflowId} />
				<div className="ml-auto flex items-center gap-2">
					<WorkflowRunButton
						projectId={projectId}
						active={!!workflow?.active}
						onPress={() => setRunOpen(true)}
					/>
					<Button variant="outline" onPress={() => setSettingsOpen(true)}>
						<TbSettings size={16} /> Settings
					</Button>
				</div>
			</RouteWorkbenchHeader>

			<main className="min-h-0 flex-1">
				<ExecutionRecordings
					key={workflowId}
					initialRunId={open}
					onClosed={() => navigate({ search: {}, replace: true })}
					projectId={projectId}
					target={{ type: "workflow", id: workflowId }}
					emptyHint="run the workflow with the Run button or its trigger"
				/>
			</main>

			{runOpen && (
				<WorkflowRunModal
					workflowId={workflowId}
					name={workflow?.name ?? "Untitled"}
					isOpen={runOpen}
					onOpenChange={setRunOpen}
				/>
			)}

			{settingsOpen && (
				<WorkflowSettingsModal
					workflowId={workflowId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
					readOnly={!canEdit}
				/>
			)}
		</div>
	);
}
