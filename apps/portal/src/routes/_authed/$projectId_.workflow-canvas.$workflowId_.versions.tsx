import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbLayoutSidebarRightCollapse, TbLayoutSidebarRightExpand } from "react-icons/tb";
import { z } from "zod";
import {
	RouteWorkbenchHeader,
	WorkflowWorkbenchTabs,
} from "@/components/routes/RouteWorkbenchTabs";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { VersionHistory, type VersionTab } from "@/components/versions/VersionHistory";
import { WorkflowSwitcher } from "@/components/workflows/WorkflowSwitcher";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { workflowsQuery } from "@/query/workflowsQuery";
import { workflowsService } from "@/services/workflows";

export const Route = createFileRoute("/_authed/$projectId_/workflow-canvas/$workflowId_/versions")({
	head: createRouteHead(
		"Workflow Versions | Workflows",
		"Look back through the saved versions of a workflow and bring one back.",
	),
	// the header's Prod chip lands here on the Production tab (#739); version opens one read-only (#780)
	validateSearch: z.object({
		tab: z.enum(["versions", "production"]).optional().catch(undefined),
		version: z.string().optional(),
	}),
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
	const { tab: tabParam, version } = Route.useSearch();
	const tab = tabParam ?? "versions";
	const navigate = Route.useNavigate();
	const { data: workflow } = workflowsQuery.byId.useQuery(workflowId);
	const [settingsOpen, setSettingsOpen] = useState(true);
	usePageTitle(workflow?.name ? `${workflow.name} | Versions` : "Workflow Versions | Workflows");

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<WorkflowSwitcher projectId={projectId} workflowId={workflowId} />
				<WorkflowWorkbenchTabs projectId={projectId} workflowId={workflowId} />
				<div className="ml-auto flex items-center gap-2">
					<ProductionChip kind="workflow" id={workflowId} projectId={projectId} />
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
				key={workflowId}
				kind="workflow"
				id={workflowId}
				projectId={projectId}
				tab={tab}
				onTabChange={(next: VersionTab) =>
					navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
				}
				settingsOpen={settingsOpen}
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
				onViewRecordings={(versionId) =>
					navigate({
						to: "/$projectId/workflow-canvas/$workflowId/executions",
						params: { projectId, workflowId },
						search: { version: versionId },
					})
				}
				initialVersionId={version}
			/>
		</div>
	);
}
