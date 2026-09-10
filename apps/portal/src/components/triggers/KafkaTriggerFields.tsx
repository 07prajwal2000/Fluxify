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
	const { data: integrations } = integrationsQuery.getAll.useQuery(projectId, "queue");
	const set = <K extends keyof KafkaValues>(key: K, next: KafkaValues[K]) =>
		onChange({ ...value, [key]: next });

	return (
		<div className="flex flex-col gap-5">
			<Select
				fullWidth
				variant="secondary"
				value={value.integrationId || null}
				onChange={(next) => set("integrationId", String(next))}
				placeholder="Choose a Kafka integration"
			>
				<Label>Integration</Label>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Description>
					{integrations?.length === 0
						? "No Kafka integration yet — add one on the Integrations page first."
						: "The brokers and credentials to read with."}
				</Description>
				<Select.Popover>
					<ListBox>
						{(integrations ?? []).map((integration) => (
							<ListBox.Item key={integration.id} id={integration.id} textValue={integration.name}>
								{integration.name}
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>

			<TextField isRequired value={value.topics} onChange={(next) => set("topics", next)}>
				<Label>Topics</Label>
				<Input placeholder="orders, payments" />
				<Description>One or more topics, separated by commas.</Description>
			</TextField>

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

export function DeliveryFields({
	value,
	onChange,
}: {
	value: DeliveryValues;
	onChange: (next: DeliveryValues) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<Checkbox
				isSelected={value.commitMode === "manual"}
				onChange={(manual) => onChange({ ...value, commitMode: manual ? "manual" : "auto" })}
				label="Commit from the workflow"
				description="Off: a batch is marked done when its run succeeds. On: the workflow calls trigger.connection.commit() itself."
			/>
			<div className="grid grid-cols-2 gap-4">
				<Counter
					label="Max attempts"
					hint="Runs of one batch before it is dead-lettered."
					value={value.maxAttempts}
					min={1}
					max={20}
					onChange={(next) => onChange({ ...value, maxAttempts: next })}
				/>
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
