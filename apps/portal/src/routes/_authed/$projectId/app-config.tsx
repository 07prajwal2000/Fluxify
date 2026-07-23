import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Button,
	Checkbox,
	Chip,
	Input,
	Label,
	Modal,
	Spinner,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { TbPlus, TbTrash } from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const ENCODINGS = ["plaintext", "base64", "hex"] as const;

export const Route = createFileRoute("/_authed/$projectId/app-config")({
	component: AppConfigPage,
});

type ConfigRow = {
	id: number;
	keyName: string;
	isEncrypted: boolean;
	dataType: string;
};

function AppConfigPage() {
	const { projectId } = Route.useParams();
	const [page, setPage] = useState(1);
	const { data, isLoading, isError } = appConfigQuery.getAll.useQuery(projectId, {
		page,
		perPage: 20,
	});
	const remove = appConfigQuery.remove.mutation(projectId);
	const [pendingDelete, setPendingDelete] = useState<ConfigRow | null>(null);

	const totalPages = data?.pagination?.totalPages ?? 1;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">App config</h1>
					<p className="text-sm text-muted">
						Key-value settings available to your routes.
					</p>
				</div>
				<CreateConfigButton projectId={projectId} />
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load config.</p>
			) : data && data.data.length === 0 ? (
				<p className="py-16 text-center text-muted">No config keys yet.</p>
			) : (
				<Table>
					<Table.Content aria-label="App config">
						<Table.Header>
							<Table.Column id="key" isRowHeader>Key</Table.Column>
							<Table.Column id="type">Type</Table.Column>
							<Table.Column id="encrypted">Encrypted</Table.Column>
							<Table.Column id="actions" aria-label="Actions">{""}</Table.Column>
						</Table.Header>
						<Table.Body items={(data?.data ?? []) as ConfigRow[]}>
							{(row: ConfigRow) => (
								<Table.Row id={String(row.id)}>
									<Table.Cell>
										<span className="font-mono text-sm">{row.keyName}</span>
									</Table.Cell>
									<Table.Cell>{row.dataType}</Table.Cell>
									<Table.Cell>
										<Chip>{row.isEncrypted ? "Yes" : "No"}</Chip>
									</Table.Cell>
									<Table.Cell>
										<div className="flex justify-end">
											<Button
												isIconOnly
												variant="ghost"
												aria-label="Delete config"
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

			{totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 text-sm text-muted">
					<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span>Page {page} of {totalPages}</span>
					<Button variant="outline" isDisabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
						Next
					</Button>
				</div>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete config key?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Config deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.keyName}</b>? This can't be undone.
			</ConfirmDialog>
		</div>
	);
}

function CreateConfigButton({ projectId }: { projectId: string }) {
	const create = appConfigQuery.create.mutation(projectId);
	const [open, setOpen] = useState(false);
	const [keyName, setKeyName] = useState("");
	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [isEncrypted, setIsEncrypted] = useState(false);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>("plaintext");

	function reset() {
		setKeyName("");
		setDescription("");
		setValue("");
		setIsEncrypted(false);
		setEncoding("plaintext");
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		create.mutate(
			{
				keyName,
				description,
				value,
				isEncrypted,
				encodingType: encoding,
				dataType: "string",
			},
			{
				onSuccess: () => {
					toast.success("Config created");
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
					<TbPlus size={16} /> New key
				</Button>
			</Modal.Trigger>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Add a config key</Modal.Heading>
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4">
									<TextField isRequired value={keyName} onChange={setKeyName}>
										<Label>Key name</Label>
										<Input placeholder="API_TIMEOUT" />
									</TextField>
									<TextField isRequired value={description} onChange={setDescription}>
										<Label>Description</Label>
										<Input placeholder="What this key controls" />
									</TextField>
									<TextField isRequired value={value} onChange={setValue}>
										<Label>Value</Label>
										<Input placeholder="Value" />
									</TextField>
									<div className="flex flex-col gap-1.5">
										<Label>Encoding</Label>
										<div className="flex gap-1.5">
											{ENCODINGS.map((enc) => (
												<Button
													key={enc}
													type="button"
													variant={encoding === enc ? "primary" : "outline"}
													onPress={() => setEncoding(enc)}
												>
													{enc}
												</Button>
											))}
										</div>
									</div>
									<Checkbox isSelected={isEncrypted} onChange={setIsEncrypted}>
										Encrypt this value
									</Checkbox>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={create.isPending}>
									Add key
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
