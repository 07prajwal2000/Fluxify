import { useState } from "react";
import {
	Checkbox,
	Input,
	Label,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { FormWizard, SummaryItem, type WizardStep } from "@/components/common/FormWizard";
import { ScheduleFields } from "@/components/workflows/ScheduleFields";
import { TriggerWorkflowsField } from "@/components/triggers/TriggerWorkflowsField";
import {
	GroupSelect,
	TRIGGER_DEFAULTS,
	TypeSelector,
	type TriggerType,
} from "@/components/triggers/triggerForm";
import { triggersQuery } from "@/query/triggersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type {
	CreateTriggerBody,
	TriggerListItem,
	UpdateTriggerBody,
} from "@/services/triggers";

export type TriggerWizardProps = {
	projectId: string;
	initialTrigger?: TriggerListItem;
	onBack: () => void;
	onSuccess: () => void;
};

export function TriggerWizard({
	projectId,
	initialTrigger,
	onBack,
	onSuccess,
}: TriggerWizardProps) {
	const isEdit = Boolean(initialTrigger);
	const create = triggersQuery.create.mutation();
	const update = triggersQuery.update.mutation();
	const { data: groups } = triggersQuery.groups.useQuery(projectId);

	const [form, setForm] = useState({
		name: initialTrigger?.name ?? TRIGGER_DEFAULTS.name,
		description: initialTrigger?.description ?? TRIGGER_DEFAULTS.description,
	});
	const [type, setType] = useState<TriggerType>(
		(initialTrigger?.type as TriggerType) || "schedule",
	);
	const [groupId, setGroupId] = useState(initialTrigger?.groupId ?? "");
	const [workflowIds, setWorkflowIds] = useState<string[]>(
		initialTrigger?.workflowIds ??
			initialTrigger?.workflows?.map((w) => w.id) ??
			[],
	);
	const [active, setActive] = useState(initialTrigger ? initialTrigger.active : true);
	const [schedule, setSchedule] = useState({
		schedule: initialTrigger?.schedule ?? "",
		timezone: initialTrigger?.timezone || "UTC",
	});

	const set = (key: keyof typeof TRIGGER_DEFAULTS, value: string) =>
		setForm((previous) => ({ ...previous, [key]: value }));

	const nameIsValid = form.name.trim().length >= 2;

	function submit() {
		if (initialTrigger) {
			const body: UpdateTriggerBody = {
				name: form.name.trim(),
				description: form.description.trim() || undefined,
				groupId: groupId || undefined,
				workflowIds,
				active,
				schedule: schedule.schedule.trim(),
				timezone: schedule.timezone || "UTC",
			};
			update.mutate(
				{ id: initialTrigger.id, body },
				{
					onSuccess: () => {
						toast.success("Trigger updated");
						onSuccess();
					},
					onError: (error) => showErrorNotification(error as Error),
				},
			);
		} else {
			create.mutate(
				{
					...form,
					name: form.name.trim(),
					description: form.description.trim() || undefined,
					type,
					projectId,
					workflowIds,
					groupId: groupId || undefined,
					active,
					schedule: schedule.schedule.trim(),
					timezone: schedule.timezone || "UTC",
				} as CreateTriggerBody,
				{
					onSuccess: () => {
						toast.success("Trigger created");
						onSuccess();
					},
					onError: (error) => showErrorNotification(error as Error),
				},
			);
		}
	}

	const steps: WizardStep[] = [
		{
			key: "type",
			label: "Source",
			title: isEdit ? "Trigger source" : "What starts it?",
			description: isEdit
				? "The source type is set when the trigger is created."
				: "The rest of the form follows from this.",
			content: <TypeSelector value={type} onChange={setType} disabled={isEdit} />,
		},
		{
			key: "basics",
			label: "Basics",
			title: isEdit ? "Edit trigger details" : "Name the trigger",
			description: "Something the run list will still make sense under later.",
			isValid: nameIsValid,
			content: (
				<div className="flex flex-col gap-5">
					<TextField
						isRequired
						autoFocus
						value={form.name}
						onChange={(value) => set("name", value)}
						isInvalid={form.name.length > 0 && !nameIsValid}
					>
						<Label>Name</Label>
						<Input placeholder="Nightly report" />
					</TextField>

					<div className="flex flex-col gap-1.5">
						<Label>Description</Label>
						<TextArea
							rows={2}
							placeholder="What this trigger is for"
							value={form.description}
							onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
								set("description", e.target.value)
							}
						/>
					</div>

					<GroupSelect
						groups={groups ?? []}
						value={groupId}
						onChange={setGroupId}
					/>
				</div>
			),
		},
		{
			key: "schedule",
			label: "Schedule",
			title: "Say when it runs",
			description:
				"The preview below is the schedule that will actually run — check it before moving on.",
			isValid: schedule.schedule.trim().length > 0,
			content: <ScheduleFields value={schedule} onChange={setSchedule} />,
		},
		{
			key: "workflows",
			label: "Workflows",
			title: "Choose what it starts",
			description:
				"Every workflow here gets its own run each time the trigger fires, so one failing never holds up the rest.",
			content: (
				<TriggerWorkflowsField
					projectId={projectId}
					value={workflowIds}
					onChange={setWorkflowIds}
				/>
			),
		},
		{
			key: "review",
			label: "Review",
			title: isEdit ? "Review and save" : "Review and create",
			description: isEdit
				? "Review the updated trigger configuration before saving."
				: "Last look before the trigger goes live.",
			content: (
				<div className="flex flex-col gap-5">
					<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
						<SummaryItem label="Name" value={form.name.trim()} />
						<SummaryItem label="Schedule" value={schedule.schedule} mono />
						<SummaryItem label="Timezone" value={schedule.timezone} />
						<SummaryItem
							label="Workflows"
							value={
								workflowIds.length === 0
									? "None yet"
									: `${workflowIds.length} attached`
							}
						/>
					</dl>

					<Checkbox
						isSelected={active}
						onChange={setActive}
						label={isEdit ? "Trigger is active" : "Turn this trigger on now"}
						description="An inactive trigger never fires, and neither does an active one with no workflows attached."
					/>
				</div>
			),
		},
	];

	return (
		<FormWizard
			title={isEdit ? "Edit trigger" : "Create a trigger"}
			description={
				isEdit
					? "Update trigger settings and attached workflows."
					: "A trigger is a source. Point it at as many workflows as you like."
			}
			onBack={onBack}
			steps={steps}
			submitLabel={isEdit ? "Save changes" : "Create trigger"}
			isPending={isEdit ? update.isPending : create.isPending}
			onSubmit={submit}
		/>
	);
}
