import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Button,
	Chip,
	Input,
	Label,
	Modal,
	Spinner,
	Table,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { TbPlus, TbTrash } from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const GROUPS = ["database", "kv", "ai", "baas", "observability"] as const;
type Group = (typeof GROUPS)[number];

export const Route = createFileRoute("/_authed/$projectId/integrations")({
	component: IntegrationsPage,
});

type Integration = { id: string; name: string; group: string; variant: string };

function IntegrationsPage() {
	const { projectId } = Route.useParams();
	const { data, isLoading, isError } = integrationsQuery.getBasicList.useQuery(projectId);
	const remove = integrationsQuery.remove.mutation(projectId);
	const [pendingDelete, setPendingDelete] = useState<Integration | null>(null);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
					<p className="text-sm text-muted">Connect third-party services.</p>
				</div>
				<AddIntegrationButton projectId={projectId} />
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load integrations.</p>
			) : !data || data.length === 0 ? (
				<p className="py-16 text-center text-muted">No integrations yet.</p>
			) : (
				<Table>
					<Table.Content aria-label="Integrations">
						<Table.Header>
							<Table.Column id="name" isRowHeader>Name</Table.Column>
							<Table.Column id="group">Group</Table.Column>
							<Table.Column id="variant">Type</Table.Column>
							<Table.Column id="actions" aria-label="Actions">{""}</Table.Column>
						</Table.Header>
						<Table.Body items={(data ?? []) as Integration[]}>
							{(row: Integration) => (
								<Table.Row id={row.id}>
									<Table.Cell>{row.name}</Table.Cell>
									<Table.Cell>
										<Chip>{row.group}</Chip>
									</Table.Cell>
									<Table.Cell>{row.variant}</Table.Cell>
									<Table.Cell>
										<div className="flex justify-end">
											<Button
												isIconOnly
												variant="ghost"
												aria-label="Delete integration"
												onPress={() => setPendingDelete(row)}
											>
												<TbTrash size={16} />
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete integration?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Integration deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.name}</b>? This can't be undone.
			</ConfirmDialog>
		</div>
	);
}

function AddIntegrationButton({ projectId }: { projectId: string }) {
	const create = integrationsQuery.create.mutation(projectId);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [group, setGroup] = useState<Group>("database");
	const [variant, setVariant] = useState("");
	const [configText, setConfigText] = useState("{\n  \n}");
	const [configError, setConfigError] = useState<string>();

	function reset() {
		setName("");
		setGroup("database");
		setVariant("");
		setConfigText("{\n  \n}");
		setConfigError(undefined);
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		let config: Record<string, unknown>;
		try {
			config = JSON.parse(configText);
		} catch {
			setConfigError("Config must be valid JSON");
			return;
		}
		create.mutate(
			{ name, group, variant, config },
			{
				onSuccess: () => {
					toast.success("Integration added");
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
					<TbPlus size={16} /> Add integration
				</Button>
			</Modal.Trigger>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Add an integration</Modal.Heading>
							<p className="mt-1 text-sm text-muted">
								Enter the connector type and its config as JSON.
							</p>
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4">
									<TextField isRequired value={name} onChange={setName}>
										<Label>Name</Label>
										<Input placeholder="Primary database" />
									</TextField>
									<div className="flex flex-col gap-1.5">
										<Label>Group</Label>
										<div className="flex flex-wrap gap-1.5">
											{GROUPS.map((g) => (
												<Button
													key={g}
													type="button"
													variant={group === g ? "primary" : "outline"}
													onPress={() => setGroup(g)}
												>
													{g}
												</Button>
											))}
										</div>
									</div>
									<TextField isRequired value={variant} onChange={setVariant}>
										<Label>Type</Label>
										<Input placeholder="PostgreSQL" />
									</TextField>
									<TextField
										value={configText}
										onChange={setConfigText}
										isInvalid={!!configError}
									>
										<Label>Config (JSON)</Label>
										<TextArea rows={6} className="font-mono text-sm" />
									</TextField>
									{configError && (
										<p className="text-sm text-danger">{configError}</p>
									)}
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={create.isPending}>
									Add integration
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
