import {
	Checkbox,
	Description,
	Input,
	Label,
	ListBox,
	Select,
	TextField,
} from "@fluxify/components";
import { integrationsQuery } from "@/query/integrationsQuery";
import { Counter } from "./triggerForm";

/** What a Kafka trigger reads, and through which integration. */
export type KafkaValues = {
	integrationId: string;
	/** comma-separated, as typed */
	topics: string;
	fromBeginning: boolean;
	createTopics: boolean;
};

export type DeliveryValues = {
	commitMode: "auto" | "manual";
	maxAttempts: number;
	retryDelayMs: number;
};

export const DELIVERY_DEFAULTS: DeliveryValues = {
	commitMode: "auto",
	maxAttempts: 3,
	retryDelayMs: 1000,
};

export function topicList(topics: string) {
	return topics
		.split(",")
		.map((topic) => topic.trim())
		.filter(Boolean);
}

export function KafkaSourceFields({
	projectId,
	value,
	onChange,
	isEdit,
}: {
	projectId: string;
	value: KafkaValues;
	onChange: (next: KafkaValues) => void;
	isEdit: boolean;
}) {
	const set = <K extends keyof KafkaValues>(key: K, next: KafkaValues[K]) =>
		onChange({ ...value, [key]: next });

	return (
		<div className="flex flex-col gap-5">
			<IntegrationField
				projectId={projectId}
				variant="Kafka"
				value={value.integrationId}
				onChange={(next) => set("integrationId", next)}
			/>

			<TextField isRequired value={value.topics} onChange={(next) => set("topics", next)}>
				<Label>Topics</Label>
				<Input placeholder="orders, payments" />
				<Description>One or more topics, separated by commas.</Description>
			</TextField>

			<Checkbox
				isSelected={value.createTopics}
				onChange={(next) => set("createTopics", next)}
				label="Create missing topics"
				description="Off: saving fails if a topic does not exist. On: missing topics are created with the cluster's default settings."
			/>

			<Checkbox
				isSelected={value.fromBeginning}
				onChange={(next) => set("fromBeginning", next)}
				isDisabled={isEdit}
				label="Read messages already in the topic"
				description="Off: only messages sent after the trigger starts. Applies to the first start only."
			/>
		</div>
	);
}

/** The queue integration a connector trigger reads through, of one variant only. */
export function IntegrationField({
	projectId,
	variant,
	value,
	onChange,
}: {
	projectId: string;
	variant: "Kafka" | "NATS" | "SQS";
	value: string;
	onChange: (next: string) => void;
}) {
	const { data } = integrationsQuery.getAll.useQuery(projectId, "queue");
	const integrations = (data ?? []).filter((integration) => integration.variant === variant);
	return (
		<Select
			fullWidth
			variant="secondary"
			value={value || null}
			onChange={(next) => onChange(String(next))}
			placeholder={`Choose a ${variant} integration`}
		>
			<Label>Integration</Label>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Description>
				{data && integrations.length === 0
					? `No ${variant} integration yet — add one on the Integrations page first.`
					: "The servers and credentials to read with."}
			</Description>
			<Select.Popover>
				<ListBox>
					{integrations.map((integration) => (
						<ListBox.Item key={integration.id} id={integration.id} textValue={integration.name}>
							{integration.name}
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}

/** What a NATS trigger reads, and through which integration. */
export type NatsValues = {
	integrationId: string;
	stream: string;
	/** comma-separated filter subjects, as typed; empty reads the whole stream */
	subjects: string;
	fromBeginning: boolean;
};

export function NatsSourceFields({
	projectId,
	value,
	onChange,
	isEdit,
}: {
	projectId: string;
	value: NatsValues;
	onChange: (next: NatsValues) => void;
	isEdit: boolean;
}) {
	const set = <K extends keyof NatsValues>(key: K, next: NatsValues[K]) =>
		onChange({ ...value, [key]: next });

	return (
		<div className="flex flex-col gap-5">
			<IntegrationField
				projectId={projectId}
				variant="NATS"
				value={value.integrationId}
				onChange={(next) => set("integrationId", next)}
			/>

			<TextField isRequired value={value.stream} onChange={(next) => set("stream", next)}>
				<Label>Stream</Label>
				<Input placeholder="ORDERS" />
				<Description>The JetStream stream to read. It must already exist.</Description>
			</TextField>

			<TextField value={value.subjects} onChange={(next) => set("subjects", next)}>
				<Label>Subjects</Label>
				<Input placeholder="orders.eu.>, orders.us.*" />
				<Description>Optional. Only these subjects of the stream, separated by commas. Empty reads all of them.</Description>
			</TextField>

			<Checkbox
				isSelected={value.fromBeginning}
				onChange={(next) => set("fromBeginning", next)}
				isDisabled={isEdit}
				label="Read messages already in the stream"
				description="Off: only messages sent after the trigger starts. Applies to the first start only."
			/>
		</div>
	);
}

export function DeliveryFields({
	value,
	onChange,
	nativeRetries,
}: {
	value: DeliveryValues;
	onChange: (next: DeliveryValues) => void;
	/** SQS: the queue's redrive policy counts attempts and dead-letters, not Fluxify. */
	nativeRetries?: boolean;
}) {
	return (
		<div className="flex flex-col gap-4">
			<Checkbox
				isSelected={value.commitMode === "manual"}
				onChange={(manual) => onChange({ ...value, commitMode: manual ? "manual" : "auto" })}
				label="Commit from the workflow"
				description="Off: a batch is marked done when its run succeeds. On: the workflow calls trigger.connection.commit() itself."
			/>
			{nativeRetries && (
				<p className="text-xs text-muted">
					A failed message goes back to the queue and SQS delivers it again. How many times, and which
					dead-letter queue it ends up in, is set by the queue's redrive policy in AWS. Add one there,
					or a message that keeps failing is retried until the queue deletes it.
				</p>
			)}
			<div className="grid grid-cols-2 gap-4">
				{!nativeRetries && (
					<Counter
						label="Max attempts"
						hint="Runs of one batch before it is dead-lettered."
						value={value.maxAttempts}
						min={1}
						max={20}
						onChange={(next) => onChange({ ...value, maxAttempts: next })}
					/>
				)}
				<Counter
					label="Retry delay (ms)"
					hint="Pause between attempts."
					value={value.retryDelayMs}
					min={0}
					max={300_000}
					onChange={(next) => onChange({ ...value, retryDelayMs: next })}
				/>
			</div>
		</div>
	);
}
