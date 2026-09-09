import { useState } from "react";
import {
	Button,
	DeleteButton,
	Description,
	Input,
	Label,
	ListBox,
	NumberField,
	Select,
	Spinner,
	Switch,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { TbBolt, TbPlus } from "react-icons/tb";
import { ScheduleFields } from "./ScheduleFields";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Section } from "@/components/common/Section";
import { triggersQuery } from "@/query/triggersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { CreateTriggerBody, Trigger } from "@/services/triggers";

/**
 * The triggers pointed at one workflow. Fan-out is two triggers, not one
 * trigger with two targets, so this list is always "what starts this workflow".
 */
export function WorkflowTriggersTab({
	workflowId,
	projectId,
}: {
	workflowId: string;
	projectId: string;
}) {
	const { data, isLoading } = triggersQuery.getAll.useQuery({
		projectId,
		workflowId,
	});
	const [adding, setAdding] = useState(false);
	const triggers = data?.data ?? [];

	return (
		<Section
			title="Triggers"
			description="What starts this workflow. Each trigger pulls its own events and hands the workflow one batch per run."
		>
			{isLoading ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : triggers.length === 0 ? (
				<div className="flex flex-col items-center rounded-lg border border-dashed border-border px-4 py-10 text-center">
					<TbBolt size={26} className="mb-2 text-muted" />
					<p className="text-sm font-medium text-foreground">No triggers yet</p>
					<p className="mt-1 text-xs text-muted">
						Nothing starts this workflow except a manual run or the Trigger
						Workflow block.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{triggers.map((trigger) => (
						<TriggerRow key={trigger.id} trigger={trigger} />
					))}
				</div>
			)}

			{adding ? (
				<NewTriggerForm
					workflowId={workflowId}
					projectId={projectId}
					onDone={() => setAdding(false)}
				/>
			) : (
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onPress={() => setAdding(true)}
				>
					<TbPlus size={14} /> Add trigger
				</Button>
			)}
		</Section>
	);
}

function TriggerRow({ trigger }: { trigger: Trigger }) {
	const update = triggersQuery.update.mutation();
	const remove = triggersQuery.remove.mutation();
	const [confirming, setConfirming] = useState(false);

	return (
		<div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-foreground">
					{trigger.name}
				</p>
				<p className="text-xs text-muted">
					{trigger.type === "schedule" ? (
						// A schedule is a single event and never batches, so the batch
						// settings would be four numbers that mean nothing here.
						<>
							schedule ·{" "}
							<span className="font-mono">{trigger.schedule}</span>
							{trigger.timezone !== "UTC" && ` · ${trigger.timezone}`}
						</>
					) : (
						<>
							{trigger.type} · batch {trigger.batchSize}
							{trigger.batchSize > 1 && ` · waits ${trigger.maxWaitMs}ms`} ·{" "}
							{trigger.concurrency} at a time
						</>
					)}
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
			<DeleteButton onPress={() => setConfirming(true)}>Delete</DeleteButton>

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Delete trigger?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() =>
					remove.mutate(trigger.id, {
						onSuccess: () => {
							toast.success("Trigger deleted");
							setConfirming(false);
						},
						onError: (error) => showErrorNotification(error as Error),
					})
				}
			>
				Delete <b className="text-foreground">{trigger.name}</b>? Events already
				waiting for it stay on the queue unread.
			</ConfirmDialog>
		</div>
	);
}

const DEFAULTS = {
	name: "",
	description: "",
	batchSize: 1,
	maxWaitMs: 0,
	maxBytes: 1024 * 1024,
	concurrency: 1,
};

const TYPES = [
	{
		id: "internal",
		label: "Internal",
		hint: "Fired by the Trigger Workflow block or a manual run.",
	},
	{
		id: "schedule",
		label: "Schedule",
		hint: "Fired by the clock — a cron expression, an interval, or once.",
	},
] as const;

function NewTriggerForm({
	workflowId,
	projectId,
	onDone,
}: {
	workflowId: string;
	projectId: string;
	onDone: () => void;
}) {
	const create = triggersQuery.create.mutation();
	const { data: groups } = triggersQuery.groups.useQuery(projectId);
	const [form, setForm] = useState(DEFAULTS);
	const [groupId, setGroupId] = useState("");
	const [type, setType] = useState<"internal" | "schedule">("internal");
	// New schedules default to UTC. A cron in a zone that observes daylight
	// saving can be skipped or run twice a year, so that is a choice to make on
	// purpose rather than inherit.
	const [schedule, setSchedule] = useState({ schedule: "", timezone: "UTC" });

	const set = <K extends keyof typeof DEFAULTS>(
		key: K,
		value: (typeof DEFAULTS)[K],
	) => setForm((previous) => ({ ...previous, [key]: value }));

	const nameIsValid = form.name.trim().length >= 2;
	const scheduled = type === "schedule";
	const canSave = nameIsValid && (!scheduled || schedule.schedule.trim().length > 0);

	function save() {
		create.mutate(
			{
				...form,
				name: form.name.trim(),
				description: form.description || undefined,
				type,
				projectId,
				workflowId,
				groupId: groupId || undefined,
				...(scheduled
					? { schedule: schedule.schedule.trim(), timezone: schedule.timezone || "UTC" }
					: {}),
			} as CreateTriggerBody,
			{
				onSuccess: () => {
					toast.success("Trigger created");
					onDone();
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-secondary p-4">
			<TextField
				isRequired
				value={form.name}
				onChange={(value) => set("name", value)}
				isInvalid={form.name.length > 0 && !nameIsValid}
			>
				<Label>Name</Label>
				<Input placeholder="Orders received" />
			</TextField>

			<div className="flex flex-col gap-1.5">
				<Label>Description</Label>
				<TextArea
					rows={2}
					placeholder="What this trigger listens for"
					value={form.description}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
						set("description", e.target.value)
					}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>Type</Label>
				<div className="grid grid-cols-2 gap-2">
					{TYPES.map((option) => (
						<button
							key={option.id}
							type="button"
							onClick={() => setType(option.id)}
							className={`rounded-lg border px-3 py-2 text-left transition-colors ${
								type === option.id
									? "border-accent bg-accent/10"
									: "border-border bg-surface hover:bg-surface-secondary"
							}`}
						>
							<p className="text-sm font-medium text-foreground">{option.label}</p>
							<p className="text-xs text-muted">{option.hint}</p>
						</button>
					))}
				</div>
				<p className="text-xs text-muted">
					Queue sources like Kafka and SQS are on the way.
				</p>
			</div>

			{scheduled && <ScheduleFields value={schedule} onChange={setSchedule} />}

			{groups && groups.length > 0 && (
				<Select
					fullWidth
					variant="secondary"
					value={groupId || (groups.find((group) => group.isDefault)?.id ?? null)}
					onChange={(next) => setGroupId(String(next))}
				>
					<Label>Group</Label>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Description>Triggers in a group run on the same workers.</Description>
					<Select.Popover>
						<ListBox>
							{groups.map((group) => (
								<ListBox.Item key={group.id} id={group.id} textValue={group.name}>
									{group.name}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
			)}

			{!scheduled && (
			<div className="grid grid-cols-2 gap-4">
				<Counter
					label="Batch size"
					hint="Events per run. 1 runs the workflow once per event."
					value={form.batchSize}
					min={1}
					max={10_000}
					onChange={(value) => set("batchSize", value)}
				/>
				<Counter
					label="Max wait (ms)"
					hint="How long a part-filled batch waits. 0 never waits."
					value={form.maxWaitMs}
					min={0}
					max={300_000}
					onChange={(value) => set("maxWaitMs", value)}
				/>
				<Counter
					label="Max bytes"
					hint="Size limit on one batch, whatever the count says."
					value={form.maxBytes}
					min={1024}
					max={64 * 1024 * 1024}
					onChange={(value) => set("maxBytes", value)}
				/>
				<Counter
					label="Concurrency"
					hint="Batches in flight. Above 1 gives up ordering."
					value={form.concurrency}
					min={1}
					max={64}
					onChange={(value) => set("concurrency", value)}
				/>
			</div>
			)}

			<div className="flex items-center gap-2">
				<Button
					variant="primary"
					size="sm"
					isDisabled={!canSave}
					isPending={create.isPending}
					onPress={save}
				>
					Create trigger
				</Button>
				<Button variant="ghost" size="sm" onPress={onDone}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function Counter({
	label,
	hint,
	value,
	min,
	max,
	onChange,
}: {
	label: string;
	hint: string;
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<NumberField
				value={value}
				minValue={min}
				maxValue={max}
				onChange={(next) => onChange(Math.min(max, Math.max(min, next || min)))}
			>
				<Label>{label}</Label>
				<NumberField.Group>
					<NumberField.DecrementButton />
					<NumberField.Input />
					<NumberField.IncrementButton />
				</NumberField.Group>
			</NumberField>
			<p className="text-xs text-muted">{hint}</p>
		</div>
	);
}
