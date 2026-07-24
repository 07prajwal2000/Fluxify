import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Button,
	Card,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { TbPlus, TbTrash } from "react-icons/tb";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export const Route = createFileRoute("/_authed/$projectId/custom-blocks")({
	component: CustomBlocksPage,
});

type Block = { id: string; label: string; name: string; description?: string | null };

function CustomBlocksPage() {
	const { projectId } = Route.useParams();
	const { data, isLoading, isError } = customBlocksQuery.getAll.useQuery(projectId);
	const remove = customBlocksQuery.remove.mutation(projectId);
	const [pendingDelete, setPendingDelete] = useState<Block | null>(null);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Custom Blocks</h1>
					<p className="text-sm text-muted">Reusable blocks for your flows.</p>
				</div>
				<CreateBlockButton projectId={projectId} />
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load custom blocks.</p>
			) : !data || data.length === 0 ? (
				<p className="py-16 text-center text-muted">No custom blocks yet.</p>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{data.map((block) => (
						<Card key={block.id} className="flex flex-col gap-3">
							<Card.Header>
								<Card.Title className="truncate">{block.label}</Card.Title>
								<Card.Description className="font-mono text-xs">{block.name}</Card.Description>
							</Card.Header>
							<Card.Content>
								<p className="line-clamp-2 text-sm text-muted">
									{block.description || "No description"}
								</p>
							</Card.Content>
							<Card.Footer>
								<Button
									isIconOnly
									variant="ghost"
									aria-label="Delete block"
									onPress={() => setPendingDelete(block as Block)}
								>
									<TbTrash size={16} />
								</Button>
							</Card.Footer>
						</Card>
					))}
				</div>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete custom block?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Block deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.label}</b>? This can't be undone.
			</ConfirmDialog>
		</div>
	);
}

function CreateBlockButton({ projectId }: { projectId: string }) {
	const create = customBlocksQuery.create.mutation(projectId);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [label, setLabel] = useState("");
	const [description, setDescription] = useState("");

	function reset() {
		setName("");
		setLabel("");
		setDescription("");
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		create.mutate(
			{ name, label, description, projectId },
			{
				onSuccess: () => {
					toast.success("Custom block created");
					reset();
					setOpen(false);
				},
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	return (
		<Modal isOpen={open} onOpenChange={setOpen}>
			<Modal.Trigger>
				<Button variant="primary">
					<TbPlus size={16} /> New block
				</Button>
			</Modal.Trigger>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Create a custom block</Modal.Heading>
							<p className="mt-1 text-sm text-muted">
								You can build its logic on the canvas afterwards.
							</p>
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4">
									<TextField isRequired value={label} onChange={setLabel}>
										<Label>Label</Label>
										<Input placeholder="Send Slack message" />
									</TextField>
									<TextField isRequired value={name} onChange={setName}>
										<Label>Name</Label>
										<Input placeholder="send_slack_message" />
									</TextField>
									<TextField value={description} onChange={setDescription}>
										<Label>Description</Label>
										<Input placeholder="What this block does" />
									</TextField>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={create.isPending}>
									Create block
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
