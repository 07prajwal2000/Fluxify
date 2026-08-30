import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Button,
	Chip,
	DeleteIconButton,
	Input,
	Label,
	Spinner,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { TbPlayerPlay, TbPlus, TbRoute } from "react-icons/tb";
import { workflowsQuery } from "@/query/workflowsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { CreateWorkflowModal } from "@/components/workflows/CreateWorkflowModal";
import { WorkflowRunModal } from "@/components/workflows/WorkflowRunModal";
import type { Workflow } from "@/services/workflows";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/workflows")({
	head: createRouteHead(
		"Workflows",
		"Build, activate and run background workflows for your project.",
	),
	component: WorkflowsPage,
});

function WorkflowsPage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState("");
	const [creating, setCreating] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);
	const [pendingRun, setPendingRun] = useState<Workflow | null>(null);

	// the server does the searching, so a match on page 3 is still found
	const { data, isLoading, isError } = workflowsQuery.getAll.useQuery({
		projectId,
		page,
		perPage: 10,
		search: search.trim() || undefined,
	});
	const toggle = workflowsQuery.toggleActive.mutation();
	const remove = workflowsQuery.remove.mutation();

	const rows = data?.data ?? [];
	const totalPages = data?.pagination?.totalPages ?? 1;

	function openCanvas(workflowId: string) {
		navigate({
			to: "/$projectId/workflow-canvas/$workflowId",
			params: { projectId, workflowId },
		});
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
					<p className="text-sm text-muted">
						Work that runs in the background. No URL, no caller waiting.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<TextField
						value={search}
						onChange={(next) => {
							setSearch(next);
							setPage(1);
						}}
						className="w-56"
					>
						<Label className="sr-only">Search workflows</Label>
						<Input placeholder="Search workflows" />
					</TextField>
					<Button variant="primary" onPress={() => setCreating(true)}>
						<TbPlus size={16} /> New workflow
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Could not load workflows.</p>
			) : rows.length === 0 ? (
				<EmptyState
					icon={<TbRoute size={28} />}
					title={search ? `No workflow matches “${search}”` : "No workflows yet"}
					description={
						search
							? "Try a different name."
							: "A workflow runs on a schedule or a trigger instead of a request — a nightly digest, a report rebuild, a sync."
					}
					action={
						!search && (
							<Button variant="primary" onPress={() => setCreating(true)}>
								<TbPlus size={16} /> New workflow
							</Button>
						)
					}
				/>
			) : (
				<Table>
					<Table.Content aria-label="Workflows">
						<Table.Header>
							<Table.Column id="name" isRowHeader>
								Name
							</Table.Column>
							<Table.Column id="description">Description</Table.Column>
							<Table.Column id="status">Status</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								{""}
							</Table.Column>
						</Table.Header>
						<Table.Body items={rows}>
							{(workflow) => (
								<Table.Row id={workflow.id}>
									<Table.Cell>{workflow.name}</Table.Cell>
									<Table.Cell>
										<span className="line-clamp-1 text-muted">
											{workflow.description}
										</span>
									</Table.Cell>
									<Table.Cell>
										<Chip>{workflow.active ? "Active" : "Inactive"}</Chip>
									</Table.Cell>
									<Table.Cell>
										<div className="flex items-center justify-end gap-2">
											<Button variant="primary" onPress={() => openCanvas(workflow.id)}>
												Open
											</Button>
											<Button
												variant="outline"
												// an inactive workflow has no artifact on a worker, so a
												// run would sit on the queue with nothing to answer it
												isDisabled={!workflow.active}
												onPress={() => setPendingRun(workflow)}
											>
												<TbPlayerPlay size={16} /> Run
											</Button>
											<Button
												variant="outline"
												onPress={() =>
													toggle.mutate(
														{ id: workflow.id, active: !workflow.active },
														{ onError: (e) => showErrorNotification(e as Error) },
													)
												}
											>
												{workflow.active ? "Disable" : "Enable"}
											</Button>
											<DeleteIconButton
												aria-label="Delete workflow"
												onPress={() => setPendingDelete(workflow)}
											/>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}

			{totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 text-sm text-muted">
					<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span>
						Page {page} of {totalPages}
					</span>
					<Button
						variant="outline"
						isDisabled={page >= totalPages}
						onPress={() => setPage((p) => p + 1)}
					>
						Next
					</Button>
				</div>
			)}

			{creating && (
				<CreateWorkflowModal
					projectId={projectId}
					isOpen={creating}
					onOpenChange={setCreating}
				/>
			)}

			{/* mounted per workflow so the payload box starts empty every time */}
			{pendingRun && (
				<WorkflowRunModal
					key={pendingRun.id}
					workflowId={pendingRun.id}
					name={pendingRun.name ?? "Untitled"}
					isOpen={!!pendingRun}
					onOpenChange={(open) => !open && setPendingRun(null)}
				/>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(open) => !open && setPendingDelete(null)}
				title="Delete workflow?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Workflow deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.name}</b>? This cannot be
				undone.
			</ConfirmDialog>
		</div>
	);
}
