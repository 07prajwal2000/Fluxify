import { toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import {
	RouteWorkbenchHeader,
	WorkflowWorkbenchTabs,
} from "@/components/routes/RouteWorkbenchTabs";
import { VersionHistory } from "@/components/versions/VersionHistory";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";

export const Route = createFileRoute("/_authed/$projectId_/workflow-canvas/$workflowId_/versions")({
	head: createRouteHead(
		"Workflow Versions | Workflows",
		"Look back through the saved versions of a workflow and bring one back.",
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
	component: WorkflowVersionsPage,
});

function WorkflowVersionsPage() {
	const { projectId, workflowId } = Route.useParams();
	const navigate = Route.useNavigate();
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	usePageTitle(workflow?.name ? `${workflow.name} | Versions` : "Workflow Versions | Workflows");

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />
				<WorkflowWorkbenchTabs projectId={projectId} workflowId={workflowId} />
			</RouteWorkbenchHeader>
			<VersionHistory
				key={workflowId}
				kind="workflow"
				id={workflowId}
				projectId={projectId}
				onBackToCanvas={() =>
					navigate({
						to: "/$projectId/workflow-canvas/$workflowId",
						params: { projectId, workflowId },
					})
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
