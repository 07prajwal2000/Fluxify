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
	BATCH_DEFAULTS,
	BatchFields,
	GroupSelect,
	TRIGGER_DEFAULTS,
	TypeSelector,
	type TriggerType,
} from "@/components/triggers/triggerForm";
import {
	DELIVERY_DEFAULTS,
	DeliveryFields,
	KafkaSourceFields,
	NatsSourceFields,
	topicList,
} from "@/components/triggers/KafkaTriggerFields";
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
	const [workflowId, setWorkflowId] = useState<string | null>(
		initialTrigger?.workflowId ?? null,
	);
	const [active, setActive] = useState(initialTrigger ? initialTrigger.active : true);
	const [schedule, setSchedule] = useState({
		schedule: initialTrigger?.schedule ?? "",
		timezone: initialTrigger?.timezone || "UTC",
	});
	const source = (initialTrigger?.source ?? {}) as {
		topics?: string[];
		fromBeginning?: boolean;
		createTopics?: boolean;
		stream?: string;
		filterSubjects?: string[];
	};
	const [kafka, setKafka] = useState({
		integrationId: initialTrigger?.integrationId ?? "",
		topics: (source.topics ?? []).join(", "),
		fromBeginning: Boolean(source.fromBeginning),
		createTopics: Boolean(source.createTopics),
	});
	const [nats, setNats] = useState({
		integrationId: initialTrigger?.integrationId ?? "",
		stream: source.stream ?? "",
		subjects: (source.filterSubjects ?? []).join(", "),
		fromBeginning: Boolean(source.fromBeginning),
	});
	const [batch, setBatch] = useState({
		batchSize: initialTrigger?.batchSize ?? BATCH_DEFAULTS.batchSize,
		maxWaitMs: initialTrigger?.maxWaitMs ?? BATCH_DEFAULTS.maxWaitMs,
		maxBytes: initialTrigger?.maxBytes ?? BATCH_DEFAULTS.maxBytes,
		concurrency: initialTrigger?.concurrency ?? BATCH_DEFAULTS.concurrency,
	});
	const [delivery, setDelivery] = useState({
		commitMode: (initialTrigger?.commitMode as "auto" | "manual") ?? DELIVERY_DEFAULTS.commitMode,
		maxAttempts: initialTrigger?.maxAttempts ?? DELIVERY_DEFAULTS.maxAttempts,
		retryDelayMs: initialTrigger?.retryDelayMs ?? DELIVERY_DEFAULTS.retryDelayMs,
	});

	const set = (key: keyof typeof TRIGGER_DEFAULTS, value: string) =>
		setForm((previous) => ({ ...previous, [key]: value }));

	const nameIsValid = form.name.trim().length >= 2;
	const isKafka = type === "kafka";
	const isNats = type === "nats";
	const topics = topicList(kafka.topics);
	const subjects = topicList(nats.subjects);

	/** The fields that differ by type; the rest of the body is shared. */
	const typeFields = isKafka
		? {
				integrationId: kafka.integrationId,
				source: { topics, fromBeginning: kafka.fromBeginning, createTopics: kafka.createTopics },
				...batch,
				...delivery,
			}
		: isNats
			? {
					integrationId: nats.integrationId,
					source: {
						stream: nats.stream.trim(),
						...(subjects.length ? { filterSubjects: subjects } : {}),
						fromBeginning: nats.fromBeginning,
					},
					...batch,
					...delivery,
				}
		: { schedule: schedule.schedule.trim(), timezone: schedule.timezone || "UTC" };

	const done = (message: string) => ({
		onSuccess: () => {
			toast.success(message);
			onSuccess();
		},
		onError: (error: unknown) => showErrorNotification(error as Error),
	});

	function submit() {
		const shared = {
			name: form.name.trim(),
			description: form.description.trim() || undefined,
			groupId: groupId || undefined,
			active,
			...typeFields,
		};
		if (initialTrigger) {
			const body: UpdateTriggerBody = { ...shared, workflowId };
			update.mutate({ id: initialTrigger.id, body }, done("Trigger updated"));
		} else {
			create.mutate(
				{
					...shared,
					type,
					projectId,
					workflowId: workflowId ?? undefined,
				} as CreateTriggerBody,
				done("Trigger created"),
			);
		}
	}

	const connectorStep: WizardStep = isNats
		? {
				key: "source",
				label: "Stream",
				title: "Say what it reads",
				description: "The NATS integration to connect with, and the stream to read.",
				isValid: Boolean(nats.integrationId) && nats.stream.trim().length > 0,
				content: (
					<NatsSourceFields projectId={projectId} value={nats} onChange={setNats} isEdit={isEdit} />
				),
			}
		: {
				key: "source",
				label: "Topics",
				title: "Say what it reads",
				description: "The Kafka integration to connect with, and the topics to read.",
				isValid: Boolean(kafka.integrationId) && topics.length > 0,
				content: (
					<KafkaSourceFields
						projectId={projectId}
						value={kafka}
						onChange={setKafka}
						isEdit={isEdit}
					/>
				),
			};

	const sourceSteps: WizardStep[] = isKafka || isNats
		? [
				connectorStep,
				{
					key: "delivery",
					label: "Delivery",
					title: "Shape each run",
					description: "How many messages one run gets, and what happens when a run fails.",
					content: (
						<div className="flex flex-col gap-6">
							<BatchFields
								value={batch}
								onChange={(key, next) => setBatch((previous) => ({ ...previous, [key]: next }))}
							/>
							<DeliveryFields value={delivery} onChange={setDelivery} />
						</div>
					),
				},
			]
		: [
				{
					key: "schedule",
					label: "Schedule",
					title: "Say when it runs",
					description:
						"The preview below is the schedule that will actually run — check it before moving on.",
					isValid: schedule.schedule.trim().length > 0,
					content: <ScheduleFields value={schedule} onChange={setSchedule} />,
				},
			];

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
						<Input placeholder={isKafka || isNats ? "New orders" : "Nightly report"} />
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
		...sourceSteps,
		{
			key: "workflow",
			label: "Workflow",
			title: "Choose what it starts",
			description:
				"A trigger starts one workflow. To run another workflow from the same source, create a second trigger or use the Trigger Workflow block.",
			content: (
				<TriggerWorkflowsField
					projectId={projectId}
					value={workflowId}
					onChange={setWorkflowId}
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
						{isKafka || isNats ? (
							<>
								{isNats ? (
									<SummaryItem label="Stream" value={nats.stream.trim()} mono />
								) : (
									<SummaryItem label="Topics" value={topics.join(", ")} mono />
								)}
								<SummaryItem label="Batch size" value={String(batch.batchSize)} />
								<SummaryItem
									label="Commit"
									value={delivery.commitMode === "manual" ? "From the workflow" : "After each run"}
								/>
							</>
						) : (
							<>
								<SummaryItem label="Schedule" value={schedule.schedule} mono />
								<SummaryItem label="Timezone" value={schedule.timezone} />
							</>
						)}
						<SummaryItem
							label="Workflow"
							value={workflowId ? "Attached" : "None yet"}
						/>
					</dl>

					<Checkbox
						isSelected={active}
						onChange={setActive}
						label={isEdit ? "Trigger is active" : "Turn this trigger on now"}
						description="An inactive trigger never fires, and neither does an active one with no workflow attached."
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
					? "Update trigger settings and the workflow it starts."
					: "A trigger is a source that starts one workflow."
			}
			onBack={onBack}
			steps={steps}
			submitLabel={isEdit ? "Save changes" : "Create trigger"}
			isPending={isEdit ? update.isPending : create.isPending}
			onSubmit={submit}
		/>
	);
}
