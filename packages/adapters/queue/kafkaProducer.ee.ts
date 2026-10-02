import { ProduceAcks, Producer, stringSerializers } from "@platformatic/kafka";
import { encodePayload, type OutgoingMessage, QueueProducer, settleEach } from "./base";
import { clientOptions, type KafkaConfig, rootCause } from "./kafka.ee";

/**
 * Publishes for the Send Message block, waiting for every in-sync replica
 * (`acks: all`).
 *
 * ponytail: one produce request per message, so each message gets its own offset
 * and its own failure. Batch per partition if bulk sends of thousands get slow.
 */
export class KafkaProducer extends QueueProducer {
	private readonly producer: Producer<string, string, string, string>;

	constructor(config: KafkaConfig) {
		super();
		this.producer = new Producer({
			...clientOptions(config),
			acks: ProduceAcks.ALL,
			serializers: stringSerializers,
		});
	}

	send(messages: OutgoingMessage[]) {
		return settleEach(messages, async (message) => {
			const partition = optionalInteger(message.options?.partition, "partition");
			const timestamp = optionalTimestamp(message.options?.timestamp);
			const result = await this.producer
				.send({
					messages: [
						{
							topic: message.destination,
							value: encodePayload(message.payload),
							...(message.key ? { key: message.key } : {}),
							...(message.headers ? { headers: message.headers } : {}),
							...(partition === undefined ? {} : { partition }),
							...(timestamp === undefined ? {} : { timestamp }),
						},
					],
				})
				.catch((error) => {
					throw new Error(rootCause(error));
				});
			const written = result.offsets?.[0];
			return {
				topic: written?.topic ?? message.destination,
				partition: written?.partition,
				offset: written?.offset?.toString(),
			};
		});
	}

	async client() {
		return this.producer;
	}

	async close() {
		await this.producer.close();
	}
}

/** A non-negative whole number, or undefined when left blank. */
function optionalInteger(value: unknown, name: string) {
	if (value === undefined || value === null || value === "") return undefined;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 0)
		throw new Error(`${name} must be a whole number of 0 or more, got ${String(value)}`);
	return number;
}

/** Milliseconds since the epoch, from a number, a Date or a date string. */
function optionalTimestamp(value: unknown) {
	if (value === undefined || value === null || value === "") return undefined;
	const ms = value instanceof Date ? value.getTime() : Number(value);
	const parsed = Number.isFinite(ms) ? ms : Date.parse(String(value));
	if (!Number.isFinite(parsed)) throw new Error(`timestamp is not a date: ${String(value)}`);
	return BigInt(Math.trunc(parsed));
}

export function createProducer(config: unknown) {
	return new KafkaProducer(config as KafkaConfig);
}
