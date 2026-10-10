import { Button, DeleteIconButton, Spinner, Table, toast } from "@fluxify/components";
import { useState } from "react";
import { TbEdit, TbFlask, TbPencil, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { showErrorNotification } from "@/lib/errorNotifier";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import type { Sandbox } from "@/services/sandboxes";
import { useCanEditProject } from "@/store/auth";
import { SandboxNameDialog } from "./SandboxNameDialog";

/** The signed-in user's sandboxes in one project: create, rename, delete, open. */
export function SandboxList({
	projectId,
	onOpen,
}: {
	projectId: string;
	onOpen: (sandboxId: string) => void;
}) {
	const canEdit = useCanEditProject(projectId);

	const { data, isLoading, isError } = sandboxesQuery.getAll.useQuery(projectId);
	const create = sandboxesQuery.create.mutation(projectId);
	const update = sandboxesQuery.update.mutation(projectId);
	const remove = sandboxesQuery.remove.mutation(projectId);

	const [creating, setCreating] = useState(false);
	const [pendingRename, setPendingRename] = useState<Sandbox | null>(null);
	const [pendingDelete, setPendingDelete] = useState<Sandbox | null>(null);

	const rows = data ?? [];

	if (!canEdit) {
		return <p className="py-16 text-center text-muted">Sandboxes are for creators and above.</p>;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Sandboxes</h1>
					<p className="text-sm text-muted">
						Your private scratch canvases. Only you can see them, and they never touch a real route.
					</p>
				</div>
				<Button variant="primary" onPress={() => setCreating(true)}>
					<TbPlus size={16} /> New sandbox
				</Button>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Could not load sandboxes.</p>
			) : rows.length === 0 ? (
				<EmptyState
					icon={<TbFlask size={28} />}
					title="No sandboxes yet"
					description="A sandbox is a private canvas where you try blocks and run them on development data, without touching a real route."
					action={
						<Button variant="primary" onPress={() => setCreating(true)}>
							<TbPlus size={16} /> New sandbox
						</Button>
					}
				/>
			) : (
				<Table>
					<Table.Content aria-label="Sandboxes">
						<Table.Header>
							<Table.Column id="name" isRowHeader>
								Name
							</Table.Column>
							<Table.Column id="updated">Last changed</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								{""}
							</Table.Column>
						</Table.Header>
						<Table.Body items={rows}>
							{(sandbox) => (
								<Table.Row id={sandbox.id}>
									<Table.Cell>{sandbox.name}</Table.Cell>
									<Table.Cell>
										<span className="text-muted">
											{new Date(sandbox.updatedAt).toLocaleString()}
										</span>
									</Table.Cell>
									<Table.Cell>
										<div className="flex items-center justify-end gap-1">
											<Button
												isIconOnly
												variant="ghost"
												aria-label={`Open ${sandbox.name}`}
												onPress={() => onOpen(sandbox.id)}
											>
												<TbEdit size={16} />
											</Button>
											<Button
												isIconOnly
												variant="ghost"
												aria-label={`Rename ${sandbox.name}`}
												onPress={() => setPendingRename(sandbox)}
											>
												<TbPencil size={16} />
											</Button>
											<DeleteIconButton
												aria-label={`Delete ${sandbox.name}`}
												onPress={() => setPendingDelete(sandbox)}
											/>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}

			{creating && (
				<SandboxNameDialog
					title="New sandbox"
					confirmText="Create"
					pending={create.isPending}
					onClose={() => setCreating(false)}
					onSubmit={(name) =>
						create.mutate(
							{ name },
							{
								onSuccess: ({ id }) => {
									setCreating(false);
									onOpen(id);
								},
								onError: (error) => showErrorNotification(error),
							},
						)
					}
				/>
			)}

			{pendingRename && (
				<SandboxNameDialog
					title="Rename sandbox"
					confirmText="Rename"
					initialName={pendingRename.name}
					pending={update.isPending}
					onClose={() => setPendingRename(null)}
					onSubmit={(name) =>
						update.mutate(
							{ id: pendingRename.id, body: { name } },
							{
								onSuccess: () => {
									toast.success("Sandbox renamed");
									setPendingRename(null);
								},
								onError: (error) => showErrorNotification(error),
							},
						)
					}
				/>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(open) => !open && setPendingDelete(null)}
				title="Delete sandbox?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Sandbox deleted"),
						onError: (error) => showErrorNotification(error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.name}</b>? Its canvas and recorded
				runs go with it. This cannot be undone.
			</ConfirmDialog>
		</div>
	);
}
