import { useState } from "react";
import {
	Button,
	Description,
	Label,
	ListBox,
	Select,
	Spinner,
	Switch,
	toast,
} from "@fluxify/components";
import { TbBolt, TbExternalLink, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Section } from "@/components/common/Section";
import { withBasePath } from "@/constants/routes";
import { triggersQuery } from "@/query/triggersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { TriggerListItem } from "@/services/triggers";

/**
 * The triggers attached to one workflow.
 *
 * This tab attaches and detaches; it does not create. A trigger belongs to the
 * project rather than to a workflow — the same schedule may start three of them
 * — so creating one from inside a single workflow's settings would make it look
 * like that workflow owned it.
 */
export function WorkflowTriggersTab({
	workflowId,
	projectId,
}: {
	workflowId: string;
	projectId: string;
}) {
	const attached = triggersQuery.getAll.useQuery({ projectId, workflowId });
	// Everything in the project, to offer what is not attached yet.
	const all = triggersQuery.getAll.useQuery({ projectId, perPage: 50 });
	const attach = triggersQuery.attach.mutation();

	const triggers = attached.data?.data ?? [];
	const attachedIds = new Set(triggers.map((trigger) => trigger.id));
	const available = (all.data?.data ?? []).filter(
		(trigger) => !attachedIds.has(trigger.id),
	);
	const [picked, setPicked] = useState("");

	function attachPicked() {
		if (!picked) return;
		attach.mutate(
			{ id: picked, workflowId },
			{
				onSuccess: () => {
					toast.success("Trigger attached");
					setPicked("");
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<Section
			title="Triggers"
			description="What starts this workflow. A trigger can start several workflows — attaching it here does not take it away from the others."
		>
			{attached.isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : triggers.length === 0 ? (
				<div className="flex flex-col items-center rounded-lg border border-dashed border-border px-4 py-10 text-center">
					<TbBolt size={26} className="mb-2 text-muted" />
					<p className="text-sm font-medium text-foreground">
						No triggers attached
					</p>
					<p className="mt-1 text-xs text-muted">
						Nothing starts this workflow except a manual run or the Trigger
						Workflow block.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{triggers.map((trigger) => (
						<TriggerRow
							key={trigger.id}
							trigger={trigger}
							workflowId={workflowId}
						/>
					))}
				</div>
			)}

			<div className="flex flex-wrap items-end gap-2">
				<Select
					fullWidth
					variant="secondary"
					className="min-w-56 flex-1"
					value={picked || null}
					isDisabled={available.length === 0}
					onChange={(next) => setPicked(String(next))}
				>
					<Label>Attach an existing trigger</Label>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Description>
						{available.length === 0
							? "Every trigger in this project is already attached."
							: "Triggers are made on the Triggers page and shared across workflows."}
					</Description>
					<Select.Popover>
						<ListBox>
							{available.map((trigger) => (
								<ListBox.Item
									key={trigger.id}
									id={trigger.id}
									textValue={trigger.name}
								>
									{trigger.name}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>

				<Button
					variant="primary"
					size="sm"
					isDisabled={!picked}
					isPending={attach.isPending}
					onPress={attachPicked}
				>
					<TbPlus size={14} /> Attach
				</Button>

				{/* A new tab, not a navigation: this panel is a modal over an unsaved
				    canvas, and leaving it would throw that away. */}
				<Button
					variant="outline"
					size="sm"
					onPress={() =>
						window.open(
							withBasePath(`/${projectId}/triggers/new`),
							"_blank",
							"noopener,noreferrer",
						)
					}
				>
					<TbExternalLink size={14} /> New trigger
				</Button>
			</div>
		</Section>
	);
}

function TriggerRow({
	trigger,
	workflowId,
}: {
	trigger: TriggerListItem;
	workflowId: string;
}) {
	const update = triggersQuery.update.mutation();
	const detach = triggersQuery.detach.mutation();
	const [confirming, setConfirming] = useState(false);
	const others = trigger.workflows.filter((w) => w.id !== workflowId);

	return (
		<div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-foreground">
					{trigger.name}
				</p>
				<p className="text-xs text-muted">
					{trigger.type === "schedule" ? (
						<>
							schedule · <span className="font-mono">{trigger.schedule}</span>
							{trigger.timezone !== "UTC" && ` · ${trigger.timezone}`}
						</>
					) : (
						trigger.type
					)}
					{others.length > 0 && ` · also starts ${others.length} other`}
				</p>
			</div>
			<Switch
				isSelected={trigger.active}
				onChange={(active) =>
					update.mutate(
						{ id: trigger.id, body: { active } },
						{
							onSuccess: () =>
								toast.success(active ? "Trigger on" : "Trigger off"),
							onError: (error) => showErrorNotification(error as Error),
						},
					)
				}
				label={trigger.active ? "Active" : "Inactive"}
			/>
			<Button variant="outline" size="sm" onPress={() => setConfirming(true)}>
				Detach
			</Button>

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Detach trigger?"
				confirmText="Detach"
				pending={detach.isPending}
				onConfirm={() =>
					detach.mutate(
						{ id: trigger.id, workflowId },
						{
							onSuccess: () => {
								toast.success("Trigger detached");
								setConfirming(false);
							},
							onError: (error) => showErrorNotification(error as Error),
						},
					)
				}
			>
				Stop <b className="text-foreground">{trigger.name}</b> starting this
				workflow?{" "}
				{others.length > 0
					? `It keeps starting ${others.length} other workflow${others.length > 1 ? "s" : ""}.`
					: "The trigger itself stays on the Triggers page."}
			</ConfirmDialog>
		</div>
	);
}
