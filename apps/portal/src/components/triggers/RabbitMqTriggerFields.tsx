import { Description, Input, Label, TextField } from "@fluxify/components";
import { IntegrationField } from "./KafkaTriggerFields";

/** What a RabbitMQ trigger reads, and through which integration. */
export type RabbitMqValues = {
	integrationId: string;
	queue: string;
};

/** RabbitMQ caps a queue name at 255 bytes. */
export const isRabbitQueue = (name: string) =>
	name.length > 0 && new TextEncoder().encode(name).length <= 255;

export function RabbitMqSourceFields({
	projectId,
	value,
	onChange,
}: {
	projectId: string;
	value: RabbitMqValues;
	onChange: (next: RabbitMqValues) => void;
}) {
	const queue = value.queue.trim();
	return (
		<div className="flex flex-col gap-5">
			<IntegrationField
				projectId={projectId}
				variant="RabbitMQ"
				value={value.integrationId}
				onChange={(integrationId) => onChange({ ...value, integrationId })}
			/>

			<TextField
				isRequired
				value={value.queue}
				onChange={(next) => onChange({ ...value, queue: next })}
				isInvalid={queue.length > 0 && !isRabbitQueue(queue)}
			>
				<Label>Queue</Label>
				<Input placeholder="orders" />
				<Description>
					The queue must already exist; Fluxify never creates it or its bindings. Give it a
					dead-letter exchange in RabbitMQ to keep messages that keep failing.
				</Description>
			</TextField>
		</div>
	);
}
