import { Button, Checkbox, Label, ListBox, Select, Spinner, toast } from "@fluxify/components";
import { useState } from "react";
import { TbBolt, TbExternalLink, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Section } from "@/components/common/Section";
import { announceWarnings, DisabledReason } from "@/components/triggers/TriggerNotices";
import { withBasePath } from "@/constants/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { triggersQuery } from "@/query/triggersQuery";
import type { TriggerListItem } from "@/services/triggers";

/** What the triggers start: a workflow, or one of the user's own sandboxes (#735). */
export type TriggerTarget = { kind: "workflow" | "sandbox"; id: string };

const WORDS = {
	workflow: {
		description:
			"What starts this workflow. Each trigger starts one workflow, so only unattached triggers can be added here.",
		empty: "Nothing starts this workflow except a manual run or the Trigger Workflow block.",
		detach: "starting this workflow",
	},
	sandbox: {
		description:
			"What runs this sandbox, on a development worker with development values. Only unattached triggers can be added here; a schedule cannot run a sandbox.",
		empty: "Nothing runs this sandbox except Run and the playground.",
		detach: "running this sandbox",
	},
};

/**
 * The triggers attached to one workflow or sandbox.
 *
 * This attaches and detaches; it does not create. A trigger starts one
 * workflow or sandbox, so only triggers attached to nothing are offered here.
 */
export function AttachedTriggers({
	target,
	projectId,
	readOnly = false,
}: {
	target: TriggerTarget;
	projectId: string;
	readOnly?: boolean;
}) {
	const words = WORDS[target.kind];
	const filter = target.kind === "sandbox" ? { sandboxId: target.id } : { workflowId: target.id };
	const attached = triggersQuery.getAll.useQuery({ projectId, ...filter });
	// Everything in the project, to offer the triggers attached to nothing.
	const all = triggersQuery.getAll.useQuery({ projectId, perPage: 50 });
	const attach = useLink(target);

	const triggers = attached.data?.data ?? [];
	const available = (all.data?.data ?? []).filter(
		(trigger) =>
			!trigger.workflowId &&
			!trigger.sandboxId &&
			(target.kind === "workflow" || trigger.type !== "schedule"),
	);
	const [picked, setPicked] = useState("");

	function attachPicked() {
		if (!picked) return;
		attach.mutate(
			{ id: picked, linked: true },
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
		<Section title="Triggers" description={words.description}>
			{attached.isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : triggers.length === 0 ? (
				<div className="flex flex-col items-center rounded-lg border border-dashed border-border px-4 py-10 text-center">
					<TbBolt size={26} className="mb-2 text-muted" />
					<p className="text-sm font-medium text-foreground">No triggers attached</p>
					<p className="mt-1 text-xs text-muted">{words.empty}</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{triggers.map((trigger) => (
						<TriggerRow key={trigger.id} trigger={trigger} target={target} readOnly={readOnly} />
					))}
				</div>
			)}

			{!readOnly && (
				<div className="flex flex-col gap-1.5">
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
							<Select.Popover>
								<ListBox>
									{available.map((trigger) => (
										<ListBox.Item key={trigger.id} id={trigger.id} textValue={trigger.name}>
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
					<p className="text-xs text-muted">
						{available.length === 0
							? "Every trigger in this project is already attached."
							: "Triggers are made on the Triggers page."}
					</p>
				</div>
			)}
		</Section>
	);
}

/**
 * Attaching or detaching. A workflow has its own endpoints; a sandbox is a
 * field on the trigger, so its link is a patch.
 */
function useLink(target: TriggerTarget) {
	const attach = triggersQuery.attach.mutation();
	const detach = triggersQuery.detach.mutation();
	const update = triggersQuery.update.mutation();
	type Link = { id: string; linked: boolean };
	type Callbacks = { onSuccess: () => void; onError: (error: unknown) => void };
	return {
		isPending: attach.isPending || detach.isPending || update.isPending,
		mutate({ id, linked }: Link, callbacks: Callbacks) {
			if (target.kind === "sandbox")
				return update.mutate({ id, body: { sandboxId: linked ? target.id : null } }, callbacks);
			const link = linked ? attach : detach;
			link.mutate({ id, workflowId: target.id }, callbacks);
		},
	};
}

const BOTH = [
	{ field: "active", label: "Prod" },
	{ field: "devActive", label: "Dev" },
] as const;
const DEV_ONLY = [BOTH[1]];

function TriggerRow({
	trigger,
	target,
	readOnly,
}: {
	trigger: TriggerListItem;
	target: TriggerTarget;
	readOnly: boolean;
}) {
	const update = triggersQuery.update.mutation();
	const detach = useLink(target);
	const [confirming, setConfirming] = useState(false);

	return (
		<div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-foreground">{trigger.name}</p>
				<p className="text-xs text-muted">
					{trigger.type === "schedule" ? (
						<>
							schedule · <span className="font-mono">{trigger.schedule}</span>
							{trigger.timezone !== "UTC" && ` · ${trigger.timezone}`}
						</>
					) : (
						trigger.type
					)}
				</p>
				<DisabledReason
					reason={trigger.active || trigger.devActive ? null : trigger.disabledReason}
				/>
			</div>
			{/* one switch per environment (#1072); a sandbox runs on development alone (#735) */}
			<div className="flex items-center gap-4">
				{(target.kind === "sandbox" ? DEV_ONLY : BOTH).map(({ field, label }) => (
					<Checkbox
						key={field}
						isSelected={trigger[field]}
						onChange={(on) =>
							update.mutate(
								{ id: trigger.id, body: { [field]: on } },
								{
									onSuccess: (result) => {
										toast.success(`${label} ${on ? "on" : "off"}`);
										announceWarnings(result.warnings);
									},
									onError: (error) => showErrorNotification(error as Error),
								},
							)
						}
						isDisabled={readOnly}
						aria-label={`${label}: ${trigger.name}`}
						label={label}
					/>
				))}
			</div>
			{!readOnly && (
				<Button variant="outline" size="sm" onPress={() => setConfirming(true)}>
					Detach
				</Button>
			)}

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Detach trigger?"
				confirmText="Detach"
				pending={detach.isPending}
				onConfirm={() =>
					detach.mutate(
						{ id: trigger.id, linked: false },
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
				Stop <b className="text-foreground">{trigger.name}</b> {WORDS[target.kind].detach}? The
				trigger itself stays on the Triggers page, idle until it is attached again.
			</ConfirmDialog>
		</div>
	);
}
