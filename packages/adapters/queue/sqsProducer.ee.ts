import { type SendMessageBatchRequestEntry, SQS } from "@aws-sdk/client-sqs";
import {
	encodePayload,
	errorText,
	type OutgoingMessage,
	QueueProducer,
	type SendOutcome,
} from "./base";
import { clientConfig, describeSqsError, SQS_MAX_BATCH, type SqsConfig } from "./sqs.ee";

/** SQS refuses a batch request over 256 KiB, summed across its entries. */
const MAX_BATCH_BYTES = 256 * 1024;

type Entry = { index: number; entry: SendMessageBatchRequestEntry; bytes: number };

/**
 * Sends for the Send Message block through `SendMessageBatch`: messages are
 * grouped by queue and split into batches of at most 10 entries and 256 KiB,
 * and SQS answers each entry on its own.
 */
export class SqsProducer extends QueueProducer {
	private readonly sqs: SQS;

	constructor(config: SqsConfig) {
		super();
		// the aggregated client: Raw mode calls `sendMessage(...)` without command classes
		this.sqs = new SQS(clientConfig(config));
	}

	async send(messages: OutgoingMessage[]) {
		const outcomes: SendOutcome[] = [];
		const byQueue = new Map<string, Entry[]>();
		messages.forEach((message, index) => {
			try {
				const entry = sqsEntry(message, index);
				const bytes = Buffer.byteLength(JSON.stringify(entry));
				const queue = byQueue.get(message.destination) ?? [];
				queue.push({ index, entry, bytes });
				byQueue.set(message.destination, queue);
			} catch (error) {
				outcomes.push({ index, ok: false, error: errorText(error) });
			}
		});
		for (const [queueUrl, entries] of byQueue)
			for (const batch of batches(entries))
				outcomes.push(...(await this.sendBatch(queueUrl, batch)));
		return outcomes.sort((a, b) => a.index - b.index);
	}

	private async sendBatch(queueUrl: string, batch: Entry[]): Promise<SendOutcome[]> {
		try {
			const result = await this.sqs.sendMessageBatch({
				QueueUrl: queueUrl,
				Entries: batch.map(({ entry }) => entry),
			});
			return batch.map(({ index, entry }): SendOutcome => {
				const sent = result.Successful?.find((s) => s.Id === entry.Id);
				if (sent)
					return {
						index,
						ok: true,
						result: {
							queueUrl,
							messageId: sent.MessageId,
							...(sent.SequenceNumber ? { sequenceNumber: sent.SequenceNumber } : {}),
						},
					};
				const failed = result.Failed?.find((f) => f.Id === entry.Id);
				return { index, ok: false, error: failed?.Message ?? failed?.Code ?? "Not sent" };
			});
		} catch (error) {
			const reason = describeSqsError(error, queueUrl);
			return batch.map(({ index }) => ({ index, ok: false, error: reason }));
		}
	}

	async client() {
		return this.sqs;
	}

	async close() {
		this.sqs.destroy();
	}
}

function sqsEntry(message: OutgoingMessage, index: number): SendMessageBatchRequestEntry {
	const options = message.options ?? {};
	const attributes = Object.entries(message.headers ?? {});
	const delay = options.delaySeconds;
	return {
		Id: String(index),
		MessageBody: encodePayload(message.payload),
		...(delay === undefined || delay === null || delay === ""
			? {}
			: { DelaySeconds: Number(delay) }),
		...(options.groupId ? { MessageGroupId: String(options.groupId) } : {}),
		...(options.deduplicationId ? { MessageDeduplicationId: String(options.deduplicationId) } : {}),
		...(attributes.length
			? {
					MessageAttributes: Object.fromEntries(
						attributes.map(([name, value]) => [name, { DataType: "String", StringValue: value }]),
					),
				}
			: {}),
	};
}

/** In order, at most 10 entries and 256 KiB a batch; an oversized entry goes alone. */
function batches(entries: Entry[]) {
	const out: Entry[][] = [];
	let current: Entry[] = [];
	let bytes = 0;
	for (const entry of entries) {
		if (
			current.length &&
			(current.length === SQS_MAX_BATCH || bytes + entry.bytes > MAX_BATCH_BYTES)
		) {
			out.push(current);
			current = [];
			bytes = 0;
		}
		current.push(entry);
		bytes += entry.bytes;
	}
	if (current.length) out.push(current);
	return out;
}

export function createProducer(config: unknown) {
	return new SqsProducer(config as SqsConfig);
}
