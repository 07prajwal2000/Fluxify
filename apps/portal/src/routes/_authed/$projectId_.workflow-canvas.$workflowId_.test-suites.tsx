import { toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { WorkflowWorkbenchTabs } from "@/components/routes/RouteWorkbenchTabs";
import { TestSuitesWorkbench } from "@/components/testSuites/TestSuitesWorkbench";
import { TestsSpotlight } from "@/components/testSuites/TestsSpotlight";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";

export const Route = createFileRoute(
	"/_authed/$projectId_/workflow-canvas/$workflowId_/test-suites",
)({
	head: createRouteHead(
		"Workflow Tests | Workflows",
		"Create, edit and run test suites for a workflow.",
	),
	beforeLoad: async ({ params, context }) => {
		try {
			const workflow = await context.queryClient.ensureQueryData({
				queryKey: ["workflows", params.workflowId, "by-id"],
				queryFn: () => workflowsService.getById(params.workflowId),
			});
			if (!workflow || workflow.projectId !== params.projectId) {
				toast.danger("Workflow not found");
				throw redirect({ to: "/$projectId/routes", params: { projectId: params.projectId } });
			}
		} catch (err) {
			if (isRedirect(err)) throw err;
			toast.danger("Workflow not found");
			throw redirect({ to: "/$projectId/routes", params: { projectId: params.projectId } });
		}
	},
	component: WorkflowTestSuitesPage,
});

/** test suites for a workflow (#487): the same workbench as a route's, with an Input tab */
function WorkflowTestSuitesPage() {
	const { projectId, workflowId } = Route.useParams();
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	usePageTitle(workflow?.name ? `${workflow.name} | Workflow Tests` : "Workflow Tests | Workflows");

	return (
		<div className="flex h-screen w-full flex-col">
			<TestSuitesWorkbench
				projectId={projectId}
				target={{ type: "workflow", id: workflowId }}
				headerLeft={
					<>
						<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />
						<WorkflowWorkbenchTabs projectId={projectId} workflowId={workflowId} />
					</>
				}
			/>
			<TestsSpotlight />
		</div>
	);
}
