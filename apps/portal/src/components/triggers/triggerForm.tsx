import {
	Description,
	Label,
	ListBox,
	NumberField,
	Select,
	cn,
} from "@fluxify/components";
import { TbClock } from "react-icons/tb";
import { SiApachekafka, SiNatsdotio } from "react-icons/si";
import type { TriggerGroup } from "@/services/triggers";
import { EnterpriseGate } from "@/components/common/Enterprise";

/**
 * The parts of a trigger form that are the same wherever it is shown.
 *
 * Kept out of the page so the wizard stays a description of its steps rather
 * than four hundred lines of fields.
 */

export type TriggerType = "schedule" | "kafka" | "nats";

export const TRIGGER_DEFAULTS = {
	name: "",
	description: "",
};

const TRIGGER_TYPE_OPTIONS = [
	{
		id: "schedule",
		label: "Schedule",
		hint: "The clock starts it — a cron expression, an interval, or once.",
		icon: <TbClock size={20} />,
		available: true,
	},
	{
		id: "kafka",
		label: "Kafka",
		hint: "Messages on a Kafka topic start it as they arrive.",
		icon: <SiApachekafka size={20} />,
		available: true,
		enterprise: true,
	},
	{
		id: "nats",
		label: "NATS",
		hint: "Messages on a NATS JetStream stream start it as they arrive.",
		icon: <SiNatsdotio size={20} />,
		available: true,
		enterprise: true,
	},
] as const;

/** Step one: what fires the trigger. Everything after it depends on the answer. */
export function TypeSelector({
	value,
	onChange,
	disabled,
}: {
	value: TriggerType;
	onChange: (value: TriggerType) => void;
	disabled?: boolean;
}) {
	return (
		<div className="grid gap-2.5 sm:grid-cols-2">
			{TRIGGER_TYPE_OPTIONS.map((option) => {
				const selected = option.available && value === option.id;
				const isOptionDisabled = !option.available || disabled;
				const card = (
					<button
						key={option.id}
						type="button"
						disabled={isOptionDisabled}
						onClick={() => onChange(option.id as TriggerType)}
						className={cn(
							"group flex items-start gap-3.5 rounded-xl border p-3 text-left transition-all duration-150",
							!option.available
								? "cursor-not-allowed border-border/50 bg-surface/50 opacity-45"
								: disabled
									? selected
										? "cursor-default border-accent/40 bg-accent/5 opacity-80"
										: "cursor-not-allowed border-border/50 bg-surface/50 opacity-45"
									: selected
										? "border-accent bg-accent/10"
										: "border-border bg-surface hover:border-accent hover:bg-surface-secondary",
						)}
					>
						<span
							className={cn(
								"flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
								option.available
									? "bg-accent/10 text-accent"
									: "bg-surface-secondary text-muted/50",
							)}
						>
							{option.icon}
						</span>
						<span className="min-w-0 flex-1">
							<span className="flex items-center gap-2">
								<span className="text-sm font-semibold text-foreground">
									{option.label}
								</span>
								{!option.available && (
									<span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
										Coming soon
									</span>
								)}
							</span>
							<span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
						</span>
					</button>
				);
				return "enterprise" in option ? (
					<EnterpriseGate key={option.id} compact>
						{card}
					</EnterpriseGate>
				) : (
					card
				);
			})}
		</div>
	);
}

export function GroupSelect({
	groups,
	value,
	onChange,
}: {
	groups: TriggerGroup[];
	value: string;
	onChange: (value: string) => void;
}) {
	if (groups.length === 0) return null;
	return (
		<Select
			fullWidth
			variant="secondary"
			value={value || (groups.find((group) => group.isDefault)?.id ?? null)}
			onChange={(next) => onChange(String(next))}
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
	);
}

export const BATCH_DEFAULTS = {
	batchSize: 1,
	maxWaitMs: 0,
	maxBytes: 1024 * 1024,
	concurrency: 1,
};

export type BatchValues = typeof BATCH_DEFAULTS;

/** How events are coalesced into a run. Not shown for a schedule, which is always one event. */
export function BatchFields({
	value,
	onChange,
}: {
	value: BatchValues;
	onChange: (key: keyof BatchValues, next: number) => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-4">
			<Counter
				label="Batch size"
				hint="Events per run. 1 runs the workflow once per event."
				value={value.batchSize}
				min={1}
				max={10_000}
				onChange={(next) => onChange("batchSize", next)}
			/>
			<Counter
				label="Max wait (ms)"
				hint="How long a part-filled batch waits. 0 never waits."
				value={value.maxWaitMs}
				min={0}
				max={300_000}
				onChange={(next) => onChange("maxWaitMs", next)}
			/>
			<Counter
				label="Max bytes"
				hint="Size limit on one batch, whatever the count says."
				value={value.maxBytes}
				min={1024}
				max={64 * 1024 * 1024}
				onChange={(next) => onChange("maxBytes", next)}
			/>
			<Counter
				label="Concurrency"
				hint="Batches in flight. Above 1 gives up ordering."
				value={value.concurrency}
				min={1}
				max={64}
				onChange={(next) => onChange("concurrency", next)}
			/>
		</div>
	);
}

export function Counter({
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
