import { useNavigate } from "@tanstack/react-router";
import { Chip } from "@fluxify/components";
import { workflowsQuery } from "@/query/workflowsQuery";
import { EntitySwitcher } from "@/components/common/EntitySwitcher";

/** The shared canvas header nav, filled with this project's workflows. */
export function WorkflowSwitcher({
	projectId,
	workflowId,
}: {
	projectId: string;
	workflowId: string;
}) {
	const navigate = useNavigate();
	// 50 is the server's max perPage — past that the list screen is the way in.
	const { data, isLoading } = workflowsQuery.getAll.useQuery({ projectId, perPage: 50 });
	const byId = workflowsQuery.byId.useQuery(workflowId);
	const listed = data?.data ?? [];
	// The open workflow can sit past page 1; keep it selectable either way.
	const workflows = listed.some((w) => w.id === workflowId) || !byId.data
		? listed
		: [{ ...byId.data, projectName: "" }, ...listed];

	return (
		<EntitySwitcher
			backLabel="Workflows"
			noun="workflow"
			currentId={workflowId}
			isLoading={isLoading}
			hasMore={Boolean(data?.pagination?.hasNext)}
			onBack={() => navigate({ to: "/$projectId/workflows", params: { projectId } })}
			onSelect={(id) =>
				navigate({
					to: "/$projectId/workflow-canvas/$workflowId",
					params: { projectId, workflowId: id },
				})
			}
			items={workflows.map((workflow) => ({
				id: workflow.id,
				textValue: workflow.name ?? workflow.id,
				label: (
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate text-xs">{workflow.name ?? "Untitled"}</span>
						{!workflow.active && (
							<Chip className="shrink-0">
								Inactive
							</Chip>
						)}
					</span>
				),
			}))}
		/>
	);
}
