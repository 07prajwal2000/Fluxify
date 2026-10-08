import { jetstream } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import { type Codec, jsonCodec } from "./codec";

export interface SubjectReader<T> extends AsyncIterable<T> {
	/** Stops reading and drops the consumer. Safe to call twice. */
	stop(): Promise<void>;
}

/**
 * Reads one subject of a `limits` stream from its first stored message, then
 * live, through an ordered (ephemeral, unacked) consumer. The server keeps the
 * order and the client resumes after a reconnect, so a reader sees every
 * message once, in order. For "replay what happened so far, then follow".
 */
export async function readSubject<T>(
	nc: NatsConnection,
	stream: string,
	subject: string,
	codec: Codec<T> = jsonCodec<T>(),
): Promise<SubjectReader<T>> {
	const consumer = await jetstream(nc).consumers.get(stream, { filter_subjects: [subject] });
	const messages = await consumer.consume();
	return {
		async *[Symbol.asyncIterator]() {
			for await (const m of messages) yield codec.decode(m.data);
		},
		stop: async () => {
			await messages.close();
		},
	};
}
