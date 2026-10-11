import {
	Button,
	Checkbox,
	CloseButton,
	DeleteButton,
	Input,
	Label,
	Modal,
	Spinner,
	Tabs,
	TextField,
	toast,
} from "@fluxify/components";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Section } from "@/components/common/Section";
import { AttachedTriggers } from "@/components/triggers/AttachedTriggers";
import { showErrorNotification } from "@/lib/errorNotifier";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import type { Sandbox } from "@/services/sandboxes";

/**
 * Everything editable about a sandbox, reachable from its canvas — the same
 * arrangement as the workflow settings modal: its name and tracing, and the
 * triggers that run it on a development worker.
 */
export function SandboxSettingsModal({
	projectId,
	sandboxId,
	isOpen,
	onOpenChange,
	readOnly = false,
}: {
	projectId: string;
	sandboxId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** viewers see the settings but can't change them */
	readOnly?: boolean;
}) {
	const { data: sandbox, isLoading } = sandboxesQuery.byId.useQuery(projectId, sandboxId);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[92vh] w-[94vw] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						{isLoading || !sandbox ? (
							<div className="flex h-full items-center justify-center">
								{isLoading ? <Spinner /> : <p className="text-sm text-muted">Sandbox not found.</p>}
							</div>
						) : (
							// Remount per sandbox so every field starts from what the server holds.
							<SettingsForm
								key={sandbox.id}
								projectId={projectId}
								sandbox={sandbox}
								readOnly={readOnly}
								onClose={() => onOpenChange(false)}
							/>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function SettingsForm({
	projectId,
	sandbox,
	readOnly,
	onClose,
}: {
	projectId: string;
	sandbox: Sandbox;
	readOnly: boolean;
	onClose: () => void;
}) {
	const [name, setName] = useState(sandbox.name);
	const [tracing, setTracing] = useState(sandbox.settings.tracingEnabled);
	const [tab, setTab] = useState("general");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const update = sandboxesQuery.update.mutation(projectId);
	const remove = sandboxesQuery.remove.mutation(projectId);
	const navigate = useNavigate();
	const trimmed = name.trim();
	const isDirty = trimmed !== sandbox.name || tracing !== sandbox.settings.tracingEnabled;

	function save() {
		update.mutate(
			{ id: sandbox.id, body: { name: trimmed, settings: { tracingEnabled: tracing } } },
			{
				onSuccess: () => {
					toast.success("Sandbox saved");
					onClose();
				},
				onError: (error) => showErrorNotification(error),
			},
		);
	}

	function deleteSandbox() {
		remove.mutate(sandbox.id, {
			onSuccess: () => {
				toast.success("Sandbox deleted");
				setConfirmDelete(false);
				onClose();
				navigate({
					to: "/$projectId/sandboxes",
					params: { projectId },
				});
			},
			onError: (error) => showErrorNotification(error),
		});
	}

	return (
		<>
			<Modal.Header className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-5 py-3">
				<div className="min-w-0">
					<Modal.Heading className="text-sm font-semibold">Sandbox settings</Modal.Heading>
					<p className="truncate text-xs text-muted">{sandbox.name}</p>
				</div>
				<CloseButton aria-label="Close sandbox settings" className="ml-auto" />
			</Modal.Header>

			<Modal.Body className="min-h-0 flex-1 p-0">
				<Tabs
					orientation="vertical"
					selectedKey={tab}
					onSelectionChange={(key) => setTab(String(key))}
					className="flex h-full min-h-0 flex-row"
				>
					<Tabs.List
						aria-label="Sandbox settings sections"
						className="w-44 shrink-0 border-r border-border p-3"
					>
						<Tabs.Tab id="general">General</Tabs.Tab>
						<Tabs.Tab id="triggers">Triggers</Tabs.Tab>
						{!readOnly && <Tabs.Tab id="danger">Danger zone</Tabs.Tab>}
					</Tabs.List>

					<Tabs.Panel id="general" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section title="Identity" description="How this sandbox shows up in lists.">
							<TextField
								isReadOnly={readOnly}
								value={name}
								onChange={setName}
								maxLength={255}
								isInvalid={name.length > 0 && !trimmed}
							>
								<Label>Name</Label>
								<Input />
							</TextField>
						</Section>

						<Section
							title="Telemetry"
							description="Every run is recorded here whether this is on or off."
						>
							<Checkbox
								isSelected={tracing}
								onChange={setTracing}
								isDisabled={readOnly}
								label="Export traces (OpenTelemetry)"
								description="Send this sandbox's spans to the project's OpenTelemetry destination."
							/>
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="triggers" className="min-h-0 flex-1 overflow-y-auto p-5">
						<AttachedTriggers
							target={{ kind: "sandbox", id: sandbox.id }}
							projectId={projectId}
							readOnly={readOnly}
						/>
					</Tabs.Panel>

					{!readOnly && (
						<Tabs.Panel id="danger" className="min-h-0 flex-1 overflow-y-auto p-5">
							<Section
								title="Delete this sandbox"
								description="Its blocks, triggers and recordings go with it. This cannot be undone."
							>
								<div className="flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-4 py-3">
									<div className="min-w-0">
										<p className="truncate text-xs">{sandbox.name}</p>
										<p className="text-xs text-muted">
											Blocks, triggers and recordings will be deleted.
										</p>
									</div>
									<DeleteButton onPress={() => setConfirmDelete(true)}>Delete sandbox</DeleteButton>
								</div>
							</Section>
						</Tabs.Panel>
					)}
				</Tabs>
			</Modal.Body>

			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title="Delete sandbox?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={deleteSandbox}
			>
				Delete <b className="text-foreground">{sandbox.name}</b>? Its blocks, triggers and
				recordings will be deleted. This cannot be undone.
			</ConfirmDialog>

			<Modal.Footer className="flex shrink-0 flex-row items-center gap-3 border-t border-border px-5 py-3">
				<span className="text-xs text-muted">
					{readOnly
						? "View only: you need the Creator role to change this sandbox"
						: isDirty
							? "Unsaved changes"
							: "All changes saved"}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="ghost" onPress={onClose}>
						{readOnly ? "Close" : "Cancel"}
					</Button>
					{!readOnly && (
						<Button
							variant="primary"
							isDisabled={!isDirty || !trimmed}
							isPending={update.isPending}
							onPress={save}
						>
							Save changes
						</Button>
					)}
				</div>
			</Modal.Footer>
		</>
	);
}
