import { Input, Label, TextArea, TextField } from "@fluxify/components";
import type { ReactNode } from "react";
import type { TriggerGroup } from "@/services/triggers";
import { NoticeList } from "./TriggerNotices";
import { Counter, GroupSelect } from "./triggerForm";

export type TriggerBasicsValues = { name: string; description: string };

/**
 * Step two: what the trigger is called, which group it runs in, and — for a
 * plugin kind that opted into retries — how many attempts it gets.
 */
export function TriggerBasicsStep({
	isEdit,
	isConnector,
	typeLabel,
	typeIcon,
	form,
	set,
	nameIsValid,
	groups,
	groupId,
	onGroupChange,
	retry,
	attempts,
	onAttemptsChange,
	retryDelayMs,
	onRetryDelayChange,
	disabledReason,
	readOnly,
}: {
	isEdit: boolean;
	isConnector: boolean;
	typeLabel: string;
	typeIcon: ReactNode;
	form: TriggerBasicsValues;
	set: (key: keyof TriggerBasicsValues, value: string) => void;
	nameIsValid: boolean;
	groups: TriggerGroup[];
	groupId: string;
	onGroupChange: (id: string) => void;
	retry?: boolean;
	attempts: number;
	onAttemptsChange: (value: number) => void;
	retryDelayMs: number;
	onRetryDelayChange: (value: number) => void;
	disabledReason?: string | null;
	readOnly?: boolean;
}) {
	return (
		<div className="flex flex-col gap-5">
			<NoticeList
				status="danger"
				title="Fluxify turned this trigger off"
				items={isEdit && disabledReason ? [disabledReason] : []}
			/>

			<div className="flex items-center gap-3 rounded-xl border border-border/80 bg-surface-secondary/40 p-3">
				<div className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
					{typeIcon}
				</div>
				<div className="min-w-0 flex-1">
					<span className="text-[11px] font-medium uppercase tracking-wider text-muted">
						Trigger Type
					</span>
					<p className="text-xs font-semibold text-foreground">{typeLabel}</p>
				</div>
			</div>

			<TextField
				isRequired
				autoFocus
				isDisabled={readOnly}
				value={form.name}
				onChange={(value) => set("name", value)}
				isInvalid={form.name.length > 0 && !nameIsValid}
			>
				<Label>Name</Label>
				<Input placeholder={isConnector ? "New orders" : "Nightly report"} />
			</TextField>

			<div className="flex flex-col gap-1.5">
				<Label>Description</Label>
				<TextArea
					rows={2}
					disabled={readOnly}
					placeholder="What this trigger is for"
					value={form.description}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
						set("description", e.target.value)
					}
				/>
			</div>

			<GroupSelect groups={groups} value={groupId} onChange={onGroupChange} isDisabled={readOnly} />

			{retry && (
				<div className="flex flex-col gap-2">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Retries</h3>
					<div className="grid grid-cols-2 gap-4">
						<Counter
							label="Max attempts"
							hint="Runs after a failure before the trigger is turned off with the reason."
							value={attempts}
							min={1}
							max={5}
							onChange={onAttemptsChange}
						/>
						<Counter
							label="Retry delay (ms)"
							hint="Pause before the first retry; doubles after each failed attempt."
							value={retryDelayMs}
							min={0}
							max={300_000}
							onChange={onRetryDelayChange}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
