import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Button,
	DeleteIconButton,
	Input,
	Label,
	Spinner,
	Switch,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { TbBolt, TbEdit, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { EditTriggerModal } from "@/components/triggers/EditTriggerModal";
import { triggersQuery } from "@/query/triggersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead } from "@/lib/seo";
import type { TriggerListItem } from "@/services/triggers";

export const Route = createFileRoute("/_authed/$projectId/triggers")({
	head: createRouteHead(
		"Triggers",
		"Start workflows on a schedule or an event instead of by hand.",
	),
	component: TriggersPage,
});

/**
 * Every trigger in the project, wherever it is used.
 *
 * Triggers live here rather than inside one workflow because a trigger is a
 * source and a source is reusable — the same schedule can start three
 * workflows. A workflow's own settings page attaches the ones it wants.
 */
function TriggersPage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState("");
	const [editingTrigger, setEditingTrigger] = useState<TriggerListItem | null>(null);
	const [pendingDelete, setPendingDelete] = useState<TriggerListItem | null>(null);

	const { data, isLoading, isError } = triggersQuery.getAll.useQuery({
		projectId,
		page,
		perPage: 10,
		search: search.trim() || undefined,
	});
	const update = triggersQuery.update.mutation();
	const remove = triggersQuery.remove.mutation();

	const rows = useMemo(() => {
		const list = data?.data ?? [];
		return [...list].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
	}, [data?.data]);
	const totalPages = data?.pagination?.totalPages ?? 1;
	const openNew = () =>
		navigate({ to: "/$projectId/triggers/new", params: { projectId } });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Triggers</h1>
					<p className="text-sm text-muted">
						What starts a workflow when nobody presses Run.
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
						<Label className="sr-only">Search triggers</Label>
						<Input placeholder="Search triggers" />
					</TextField>
					<Button variant="primary" onPress={openNew}>
						<TbPlus size={16} /> New trigger
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Could not load triggers.</p>
			) : rows.length === 0 ? (
				<EmptyState
					icon={<TbBolt size={28} />}
					title={search ? `No trigger matches “${search}”` : "No triggers yet"}
					description={
						search
							? "Try a different name."
							: "A trigger starts workflows on a schedule or an event. Create one here, then attach it to as many workflows as you need."
					}
					action={
						!search && (
							<Button variant="primary" onPress={openNew}>
								<TbPlus size={16} /> New trigger
							</Button>
						)
					}
				/>
			) : (
				<Table>
					<Table.Content aria-label="Triggers">
						<Table.Header>
							<Table.Column id="name" isRowHeader>
								Name
							</Table.Column>
							<Table.Column id="fires">Fires</Table.Column>
							<Table.Column id="workflows">Workflows</Table.Column>
							<Table.Column id="status">Status</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								{""}
							</Table.Column>
						</Table.Header>
						<Table.Body items={rows}>
							{(trigger) => (
								<Table.Row id={trigger.id}>
									<Table.Cell>{trigger.name}</Table.Cell>
									<Table.Cell>
										<span className="text-muted">
											{trigger.type === "schedule" ? (
												<span className="font-mono text-xs">
													{trigger.schedule}
												</span>
											) : (
												trigger.type
											)}
										</span>
									</Table.Cell>
									<Table.Cell>
										{trigger.workflows.length === 0 ? (
											// An active trigger attached to nothing is the one state
											// that looks fine and does nothing at all.
											<span className="text-xs text-warning">None attached</span>
										) : (
											<span className="line-clamp-1 text-muted">
												{trigger.workflows.map((w) => w.name).join(", ")}
											</span>
										)}
									</Table.Cell>
									<Table.Cell>
										<Switch
											isSelected={trigger.active}
											onChange={(active) =>
												update.mutate(
													{ id: trigger.id, body: { active } },
													{
														onSuccess: () =>
															toast.success(active ? "Trigger on" : "Trigger off"),
														onError: (e) => showErrorNotification(e as Error),
													},
												)
											}
											label={trigger.active ? "Active" : "Inactive"}
										/>
									</Table.Cell>
									<Table.Cell>
										<div className="flex items-center justify-end gap-1">
											<Button
												isIconOnly
												variant="ghost"
												aria-label={`Edit ${trigger.name}`}
												onPress={() => setEditingTrigger(trigger)}
											>
												<TbEdit size={16} />
											</Button>
											<DeleteIconButton
												aria-label="Delete trigger"
												onPress={() => setPendingDelete(trigger)}
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
					<Button
						variant="outline"
						isDisabled={page <= 1}
						onPress={() => setPage((p) => p - 1)}
					>
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

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(open) => !open && setPendingDelete(null)}
				title="Delete trigger?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Trigger deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.name}</b>? Every
				workflow it starts keeps working, but nothing will start it.
			</ConfirmDialog>

			<EditTriggerModal
				projectId={projectId}
				trigger={editingTrigger}
				onClose={() => setEditingTrigger(null)}
			/>
		</div>
	);
}
