import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
	Button,
	CloseButton,
	DeleteButton,
	Input,
	Label,
	Modal,
	NumberField,
	Spinner,
	Switch,
	Tabs,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Section } from "@/components/common/Section";
import { workflowsQuery } from "@/query/workflowsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { Workflow } from "@/services/workflows";

/**
 * Everything editable about a workflow, reachable from its canvas — the same
 * arrangement as the route settings modal, minus the HTTP contract a workflow
 * does not have.
 */
export function WorkflowSettingsModal({
	workflowId,
	isOpen,
	onOpenChange,
}: {
	workflowId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: workflow, isLoading } = workflowsQuery.byId.useQuery(workflowId);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[92vh] w-[94vw] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						{isLoading || !workflow ? (
							<div className="flex h-full items-center justify-center">
								{isLoading ? (
									<Spinner />
								) : (
									<p className="text-sm text-muted">Workflow not found.</p>
								)}
							</div>
						) : (
							// Remount per workflow so every field starts from what the server holds.
							<WorkflowSettingsForm
								key={workflow.id}
								workflow={workflow}
								onSaved={() => onOpenChange(false)}
								onClose={() => onOpenChange(false)}
							/>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function WorkflowSettingsForm({
	workflow,
	onSaved,
	onClose,
}: {
	workflow: Workflow;
	onSaved: () => void;
	onClose: () => void;
}) {
	const update = workflowsQuery.update.mutation(workflow.id);
	const remove = workflowsQuery.remove.mutation();
	const navigate = useNavigate();

	const [name, setName] = useState(workflow.name ?? "");
	const [description, setDescription] = useState(workflow.description ?? "");
	const [active, setActive] = useState(Boolean(workflow.active));
	const [timeoutSeconds, setTimeoutSeconds] = useState(workflow.timeoutSeconds);
	const [tracingEnabled, setTracingEnabled] = useState(workflow.tracingEnabled);
	const [recordExecution, setRecordExecution] = useState(workflow.recordExecution);
	const [tab, setTab] = useState("general");
	const [confirmDelete, setConfirmDelete] = useState(false);

	const payload = useMemo(
		() => ({
			name: name.trim(),
			description,
			active,
			timeoutSeconds,
			tracingEnabled,
			recordExecution,
		}),
		[
			name,
			description,
			active,
			timeoutSeconds,
			tracingEnabled,
			recordExecution,
		],
	);
	const [baseline] = useState(() => JSON.stringify(payload));
	const isDirty = JSON.stringify(payload) !== baseline;
	const nameIsValid = name.trim().length >= 2;

	function save() {
		update.mutate(payload, {
			onSuccess: () => {
				toast.success("Workflow settings saved");
				onSaved();
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	function deleteWorkflow() {
		remove.mutate(workflow.id, {
			onSuccess: () => {
				toast.success("Workflow deleted");
				setConfirmDelete(false);
				onClose();
				navigate({
					to: "/$projectId/workflows",
					params: { projectId: workflow.projectId },
				});
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	return (
		<>
			<Modal.Header className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-5 py-3">
				<div className="min-w-0">
					<Modal.Heading className="text-sm font-semibold">
						Workflow settings
					</Modal.Heading>
					<p className="truncate text-xs text-muted">{workflow.name}</p>
				</div>
				<CloseButton aria-label="Close workflow settings" className="ml-auto" />
			</Modal.Header>

			<Modal.Body className="min-h-0 flex-1 p-0">
				<Tabs
					orientation="vertical"
					selectedKey={tab}
					onSelectionChange={(key) => setTab(String(key))}
					className="flex h-full min-h-0 flex-row"
				>
					<Tabs.List
						aria-label="Workflow settings sections"
						className="w-44 shrink-0 border-r border-border p-3"
					>
						<Tabs.Tab id="general">General</Tabs.Tab>
						<Tabs.Tab id="advanced">Advanced</Tabs.Tab>
						<Tabs.Tab id="danger">Danger zone</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel id="general" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Identity"
							description="How this workflow shows up in lists and logs."
						>
							<TextField
								isRequired
								value={name}
								onChange={setName}
								isInvalid={name.length > 0 && !nameIsValid}
							>
								<Label>Name</Label>
								<Input placeholder="Nightly report" />
							</TextField>

							<div className="flex flex-col gap-1.5">
								<Label>Description</Label>
								<TextArea
									rows={3}
									placeholder="What this workflow does"
									value={description}
									onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
										setDescription(e.target.value)
									}
								/>
							</div>
						</Section>

						<Section
							title="Availability"
							description="An inactive workflow is never published to your workers, so nothing can run it — not a trigger, not a manual run."
						>
							<Switch
								isSelected={active}
								onChange={setActive}
								label={active ? "Workflow is active" : "Workflow is inactive"}
							/>
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="advanced" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Time limit"
							description="A stuck run is stopped rather than occupying a worker. Between 30 seconds and an hour."
						>
							<NumberField
								value={timeoutSeconds}
								onChange={(next) =>
									setTimeoutSeconds(Math.min(3600, Math.max(30, next || 30)))
								}
								minValue={30}
								maxValue={3600}
								className="w-52"
							>
								<Label>Timeout (seconds)</Label>
								<NumberField.Group>
									<NumberField.DecrementButton />
									<NumberField.Input />
									<NumberField.IncrementButton />
								</NumberField.Group>
							</NumberField>
						</Section>

						<Section
							title="Telemetry"
							description="Collect traces for every run. Useful while building, noise once the workflow is boring."
						>
							<Switch
								isSelected={tracingEnabled}
								onChange={setTracingEnabled}
								label={tracingEnabled ? "Telemetry enabled" : "Telemetry disabled"}
							/>
						</Section>

						<Section
							title="Execution history"
							description="Keep a record of each run, so a failure can be inspected after the fact."
						>
							<Switch
								isSelected={recordExecution}
								onChange={setRecordExecution}
								label={recordExecution ? "Runs are recorded" : "Runs are not recorded"}
							/>
						</Section>
					</Tabs.Panel>

					<Tabs.Panel id="danger" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Delete this workflow"
							description="Its canvas goes with it, and any trigger pointing at it stops firing. This cannot be undone."
						>
							<div className="flex items-center justify-between rounded-md border border-danger/40 bg-danger/5 px-4 py-3">
								<div className="min-w-0">
									<p className="truncate text-xs">{workflow.name}</p>
									<p className="text-xs text-muted">Queued runs will be dropped.</p>
								</div>
								<DeleteButton onPress={() => setConfirmDelete(true)}>
									Delete workflow
								</DeleteButton>
							</div>
						</Section>
					</Tabs.Panel>
				</Tabs>
			</Modal.Body>

			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title="Delete workflow?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={deleteWorkflow}
			>
				Delete <b className="text-foreground">{workflow.name}</b>? This cannot be
				undone.
			</ConfirmDialog>

			<Modal.Footer className="flex shrink-0 flex-row items-center gap-3 border-t border-border px-5 py-3">
				<span className="text-xs text-muted">
					{isDirty ? "Unsaved changes" : "All changes saved"}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						isDisabled={!isDirty || !nameIsValid}
						isPending={update.isPending}
						onPress={save}
					>
						Save changes
					</Button>
				</div>
			</Modal.Footer>
		</>
	);
}
