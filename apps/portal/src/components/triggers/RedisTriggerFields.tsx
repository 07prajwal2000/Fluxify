import { Checkbox, Description, Input, Label, TextField } from "@fluxify/components";
import { ConsumerGroupField, IntegrationField } from "./KafkaTriggerFields";
import { Counter } from "./triggerForm";

/** What a Redis Streams trigger reads, and through which KV integration. */
export type RedisValues = {
	integrationId: string;
	stream: string;
	/** null uses the generated default; a string is the user's own, "" while typing */
	consumerGroup: string | null;
	/** empty is the worker's host name */
	consumer: string;
	fromBeginning: boolean;
	claimIdleSec: number;
	/** empty is `<stream>:dlq` */
	dlqStream: string;
};

/** Redis takes any key; whitespace is refused because it is almost always a typo. */
export const isRedisName = (name: string) => /^\S{1,1024}$/.test(name);

export function RedisSourceFields({
	projectId,
	value,
	onChange,
	isEdit,
}: {
	projectId: string;
	value: RedisValues;
	onChange: (next: RedisValues) => void;
	isEdit: boolean;
}) {
	const set = <K extends keyof RedisValues>(key: K, next: RedisValues[K]) =>
		onChange({ ...value, [key]: next });
	const stream = value.stream.trim();

	return (
		<div className="flex flex-col gap-5">
			<IntegrationField
				projectId={projectId}
				variant="Redis"
				value={value.integrationId}
				onChange={(next) => set("integrationId", next)}
			/>

			<TextField
				isRequired
				value={value.stream}
				onChange={(next) => set("stream", next)}
				isInvalid={stream.length > 0 && !isRedisName(stream)}
			>
				<Label>Stream key</Label>
				<Input placeholder="orders" />
				<Description>The stream to read. Created empty if it does not exist yet.</Description>
			</TextField>

			<ConsumerGroupField
				variant="Redis"
				value={value.consumerGroup}
				onChange={(next) => set("consumerGroup", next)}
				isEdit={isEdit}
			/>

			<TextField
				value={value.consumer}
				onChange={(next) => set("consumer", next)}
				isInvalid={value.consumer.trim().length > 0 && !isRedisName(value.consumer.trim())}
			>
				<Label>Consumer name</Label>
				<Input placeholder="Each worker's own name" />
				<Description>
					Optional. Leave it empty so every worker reads under its own name. A shared name is safe
					only when a single worker runs this trigger.
				</Description>
			</TextField>

			<Checkbox
				isSelected={value.fromBeginning}
				onChange={(next) => set("fromBeginning", next)}
				isDisabled={isEdit}
				label="Read entries already in the stream"
				description="Off: only entries added after the trigger starts. Applies only when Fluxify creates the group."
			/>

			<Counter
				label="Reclaim after (s)"
				hint="How long an entry left unfinished (its worker crashed, or its run failed) waits before it is read again. A run still going keeps its entries."
				value={value.claimIdleSec}
				min={1}
				max={86_400}
				onChange={(next) => set("claimIdleSec", next)}
			/>

			<TextField
				value={value.dlqStream}
				onChange={(next) => set("dlqStream", next)}
				isInvalid={value.dlqStream.trim().length > 0 && !isRedisName(value.dlqStream.trim())}
			>
				<Label>Dead-letter stream</Label>
				<Input placeholder={`${stream || "<stream>"}:dlq`} />
				<Description>
					Optional. Where an entry goes once its attempts run out, with the error attached.
				</Description>
			</TextField>
		</div>
	);
}
