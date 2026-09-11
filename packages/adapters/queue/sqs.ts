import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "@fluxify/common";
import {
	ChangeMessageVisibilityBatchCommand,
	DeleteMessageBatchCommand,
	GetQueueAttributesCommand,
	ListQueuesCommand,
	ReceiveMessageCommand,
	SQSClient,
	type Message,
} from "@aws-sdk/client-sqs";
import {
	decode,
	QueueConnection,
	QueueSourceGoneError,
	type QueueBatch,
	type QueueEvent,
	type QueueHandler,
	type QueueSubscription,
} from "./base";

/**
 * An AWS SQS queue. SQS pushes nothing: each worker long-polls, and the
 * visibility timeout is the only lever — a received message is hidden, a
 * committed one is deleted, anything else reappears once it lapses.
 *
 * Retries and dead-lettering belong to the queue's own redrive policy. Each
 * receive is one attempt; a failed or uncommitted batch is hidden for the retry
 * delay and comes back, and after `maxReceiveCount` receives AWS moves it to the
 * dead-letter queue. With no redrive policy a poison message returns until the
 * queue's retention period drops it.
 */

/** An SQS integration's config, `cfg:` references already expanded. */
export type SqsConfig = {
	region: string;
	/** unset falls back to the SDK's default chain: env, profile, instance role */
	accessKeyId?: string;
	secretAccessKey?: string;
	sessionToken?: string;
	/** an SQS-compatible endpoint (floci, LocalStack, ElasticMQ); unset is AWS */
	endpoint?: string;
};

/** What an SQS trigger reads. */
export type SqsSource = {
	queueUrl: string;
	/** long-poll wait, 0–20s; 0 is a short poll, one billed request per call */
	waitTimeSeconds?: number;
	/** how long a received message stays hidden; the heartbeat extends it while a run lasts */
	visibilityTimeoutSec?: number;
};

/** SQS returns at most 10 messages a receive, and every batch API takes at most 10 entries. */
export const SQS_MAX_BATCH = 10;
/** SQS refuses a visibility timeout past 12 hours. */
const MAX_VISIBILITY_SEC = 43_200;

export function clientFor(config: SqsConfig) {
	return new SQSClient({
		region: config.region,
		...(config.endpoint ? { endpoint: config.endpoint } : {}),
		...(config.accessKeyId && config.secretAccessKey
			? {
					credentials: {
						accessKeyId: config.accessKeyId,
						secretAccessKey: config.secretAccessKey,
						...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
					},
				}
			: {}),
	});
}

export class SqsQueueConnection extends QueueConnection {
	override readonly deadLettersNatively = true;
	private client?: SQSClient;
	private subscription!: QueueSubscription;
	private handler!: QueueHandler;
	private queueUrl = "";
	private waitTimeSeconds = 20;
	private visibilitySec = 30;
	private readonly workers: Promise<void>[] = [];
	private readonly aborter = new AbortController();
	/** received and not yet deleted; released on stop so a restart gets them at once */
	private readonly unacked = new Set<Message>();
	private readonly sources = new WeakMap<QueueEvent, Message>();
	private stopped = false;

	constructor(private readonly config: SqsConfig) {
		super();
	}

	async consume(subscription: QueueSubscription, handler: QueueHandler) {
		const source = subscription.source as Partial<SqsSource>;
		if (!source.queueUrl) throw new Error("An SQS trigger needs a queue URL");
		this.subscription = subscription;
		this.handler = handler;
		this.queueUrl = source.queueUrl;
		this.waitTimeSeconds = clamp(source.waitTimeSeconds ?? 20, 0, 20);
		this.visibilitySec = clamp(source.visibilityTimeoutSec ?? 30, 1, MAX_VISIBILITY_SEC);
		this.client = clientFor(this.config);
		// fails the start on a missing queue or bad credentials, not the first poll
		try {
			await this.client.send(new GetQueueAttributesCommand({ QueueUrl: this.queueUrl, AttributeNames: ["QueueArn"] }));
		} catch (error) {
			throw isQueueGone(error) ? new QueueSourceGoneError(describeSqsError(error, this.queueUrl)) : new Error(describeSqsError(error, this.queueUrl));
		}
		for (let i = 0; i < subscription.concurrency; i++) this.workers.push(this.work());
	}

	async commit(batch: QueueBatch) {
		const messages = this.messagesOf(batch);
		const result = await this.client!.send(
			new DeleteMessageBatchCommand({
				QueueUrl: this.queueUrl,
				Entries: messages.map((message, i) => ({ Id: String(i), ReceiptHandle: message.ReceiptHandle! })),
			}),
		);
		for (const [i, message] of messages.entries())
			if (!result.Failed?.some((failed) => failed.Id === String(i))) this.unacked.delete(message);
		// usually a lapsed visibility timeout: the message was handed to someone else
		if (result.Failed?.length)
			throw new Error(`SQS refused to delete ${result.Failed.length} message(s): ${result.Failed[0]!.Message ?? result.Failed[0]!.Code}`);
	}

	async moveToDLQ() {
		throw new Error(
			"SQS dead-letters through the queue's redrive policy: throw from the workflow, or leave the batch uncommitted, and AWS moves it after maxReceiveCount receives",
		);
	}

	async lag() {
		if (!this.client) return null;
		const { Attributes } = await this.client.send(
			new GetQueueAttributesCommand({
				QueueUrl: this.queueUrl,
				AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
			}),
		);
		return Number(Attributes?.ApproximateNumberOfMessages ?? 0) + Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
	}

	/** Takes up to the wait time: an in-flight long poll is finished, not abandoned. */
	async stop() {
		this.stopped = true;
		this.aborter.abort(); // the retry sleep only
		await Promise.allSettled(this.workers);
		await this.release([...this.unacked], 0).catch(() => undefined);
		this.unacked.clear();
		this.client?.destroy();
	}

	raw() {
		return this.client;
	}

	private async work() {
		while (!this.stopped) {
			let messages: Message[];
			try {
				messages = await this.receive();
			} catch (error) {
				if (this.stopped) return;
				if (isQueueGone(error)) return this.gone(error);
				logger.warn(`[sqs] ${this.subscription.consumerGroup} receive failed: ${describeSqsError(error, this.queueUrl)}`, "QUEUE.sqs");
				await sleep(1_000, undefined, { signal: this.aborter.signal }).catch(() => undefined);
				continue;
			}
			for (const batch of this.split(messages)) await this.deliver(batch);
		}
	}

	/** Deleted under us: every worker stops, and the owner hears it once. */
	private gone(error: unknown) {
		this.stopped = true;
		this.aborter.abort();
		// nothing to hand back: the messages went with the queue
		this.unacked.clear();
		logger.error(`[sqs] ${this.subscription.consumerGroup} queue ${this.queueUrl} is gone, stopping`, "QUEUE.sqs");
		this.subscription.onSourceGone?.(new QueueSourceGoneError(describeSqsError(error, this.queueUrl)));
	}

	private async receive() {
		const { Messages = [] } = await this.client!.send(
			new ReceiveMessageCommand({
				QueueUrl: this.queueUrl,
				MaxNumberOfMessages: clamp(this.subscription.batchSize, 1, SQS_MAX_BATCH),
				WaitTimeSeconds: this.waitTimeSeconds,
				VisibilityTimeout: this.visibilitySec,
				MessageSystemAttributeNames: ["All"],
				MessageAttributeNames: ["All"],
			}),
			// never aborted: SQS still fills an abandoned long poll, hiding those
			// messages for the whole visibility timeout. Stop waits it out instead and
			// hands back whatever it brought.
		);
		for (const message of Messages) this.unacked.add(message);
		return Messages;
	}

	/** Cuts a receive before it goes over `maxBytes` — but never into an empty batch. */
	private split(messages: Message[]) {
		const batches: Message[][] = [];
		let bytes = 0;
		for (const message of messages) {
			const size = Buffer.byteLength(message.Body ?? "");
			const last = batches.at(-1);
			if (!last || bytes + size > this.subscription.maxBytes) {
				batches.push([message]);
				bytes = size;
			} else {
				last.push(message);
				bytes += size;
			}
		}
		return batches;
	}

	private async deliver(messages: Message[]) {
		if (this.stopped) return this.release(messages, 0).catch(() => undefined);
		const attempt = Math.max(...messages.map((m) => Number(m.Attributes?.ApproximateReceiveCount ?? 1)));
		const batch: QueueBatch = {
			events: messages.map((message) => this.toEvent(message)),
			consumerGroup: this.subscription.consumerGroup,
			highWatermark: null,
			attempt,
		};
		// a long run must not outlast the visibility timeout, or another worker gets the batch
		const heartbeat = setInterval(() => {
			const held = messages.filter((m) => this.unacked.has(m));
			if (held.length)
				this.release(held, this.visibilitySec).catch((error) =>
					logger.warn(`[sqs] ${batch.consumerGroup} heartbeat failed: ${String(error)}`, "QUEUE.sqs"),
				);
		}, Math.max((this.visibilitySec * 1000) / 3, 500));
		let failure: unknown;
		try {
			await this.handler(batch, this);
		} catch (error) {
			failure = error;
		} finally {
			clearInterval(heartbeat);
		}
		// failed, or a manual batch the workflow never committed: back after the retry delay
		const leftover = messages.filter((m) => this.unacked.has(m));
		if (!leftover.length || this.stopped) return;
		const delaySec = retryDelaySec(this.subscription.retryDelayMs, attempt);
		logger.warn(
			`[sqs] ${batch.consumerGroup} returning ${leftover.length} message(s) in ${delaySec}s (receive ${attempt}): ${failure ? String(failure) : "not committed"}`,
			"QUEUE.sqs",
		);
		await this.release(leftover, delaySec).catch((error) =>
			logger.warn(`[sqs] ${batch.consumerGroup} could not return messages, they reappear when visibility lapses: ${String(error)}`, "QUEUE.sqs"),
		);
		for (const message of leftover) this.unacked.delete(message);
	}

	/** Sets how long until the messages are visible again; 0 hands them back now. */
	private async release(messages: Message[], seconds: number) {
		if (!messages.length || !this.client) return;
		await this.client.send(
			new ChangeMessageVisibilityBatchCommand({
				QueueUrl: this.queueUrl,
				Entries: messages.map((message, i) => ({
					Id: String(i),
					ReceiptHandle: message.ReceiptHandle!,
					VisibilityTimeout: seconds,
				})),
			}),
		);
	}

	private messagesOf(batch: QueueBatch) {
		const messages = batch.events.map((event) => this.sources.get(event));
		if (messages.some((message) => !message)) throw new Error("This batch was not read by this connection");
		return messages as Message[];
	}

	private toEvent(message: Message): QueueEvent {
		const headers: Record<string, string> = {};
		for (const [name, value] of Object.entries(message.MessageAttributes ?? {}))
			if (value.StringValue !== undefined) headers[name] = value.StringValue;
		const sent = Number(message.Attributes?.SentTimestamp);
		const event: QueueEvent = {
			data: decode(new TextEncoder().encode(message.Body ?? "")),
			topic: this.queueUrl.split("/").pop()!,
			partition: 0,
			offset: message.MessageId!,
			key: message.Attributes?.MessageGroupId ?? null,
			headers,
			timestamp: new Date(Number.isFinite(sent) ? sent : Date.now()).toISOString(),
		};
		this.sources.set(event, message);
		return event;
	}
}

/** Exponential from the trigger's retry delay, in whole seconds as SQS wants them. */
export function retryDelaySec(baseMs = 1_000, attempt: number) {
	return clamp(Math.round((baseMs * 2 ** (attempt - 1)) / 1000), 0, MAX_VISIBILITY_SEC);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, Math.floor(value)));
}

export function createConnection(config: unknown) {
	return new SqsQueueConnection(config as SqsConfig);
}

/**
 * Makes sure a trigger's queue exists before it is saved; queues are never
 * created here. Returns the redrive policy, which is absent when failures have
 * nowhere to go.
 */
export async function assertSqsQueue(config: SqsConfig, queueUrl: string) {
	const client = clientFor(config);
	try {
		const { Attributes } = await client.send(
			new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["RedrivePolicy", "VisibilityTimeout"] }),
		);
		const redrive = Attributes?.RedrivePolicy ? JSON.parse(Attributes.RedrivePolicy) : null;
		return {
			redrivePolicy: redrive as { deadLetterTargetArn: string; maxReceiveCount: number } | null,
			visibilityTimeoutSec: Number(Attributes?.VisibilityTimeout ?? 30),
		};
	} catch (error) {
		throw new Error(describeSqsError(error, queueUrl));
	} finally {
		client.destroy();
	}
}

/**
 * What a user should know before an SQS trigger runs. `queue` is what
 * `assertSqsQueue` read; without it only the settings are judged.
 */
export function sqsWarnings(
	settings: { batchSize?: number; waitTimeSeconds?: number },
	queue?: Awaited<ReturnType<typeof assertSqsQueue>>,
) {
	const warnings: string[] = [];
	if ((settings.batchSize ?? 1) > SQS_MAX_BATCH)
		warnings.push(`Batch size ${settings.batchSize} is above the SQS limit of ${SQS_MAX_BATCH}; each run gets at most ${SQS_MAX_BATCH} messages.`);
	if (settings.waitTimeSeconds === 0)
		warnings.push("A wait time of 0 turns long polling off: the trigger asks SQS for messages non-stop, and AWS bills every request. 20 seconds is recommended.");
	if (!queue) return warnings;
	const redrive = queue.redrivePolicy;
	warnings.push(
		redrive
			? `Retries follow the queue's redrive policy: after ${redrive.maxReceiveCount} receives, AWS moves a failing message to "${redrive.deadLetterTargetArn.split(":").pop()}". The trigger's max attempts setting is not used.`
			: "This queue has no dead-letter queue. A message that keeps failing is retried until the queue's retention period deletes it. Add a redrive policy to the queue in AWS to keep failed messages.",
	);
	return warnings;
}

/**
 * Proves the credentials sign a request SQS accepts. AccessDenied still passes:
 * AWS only says it after the signature checks out, and a key scoped to one
 * queue has no business listing the rest.
 */
export async function testSqsConnection(config: SqsConfig) {
	const client = clientFor(config);
	try {
		await client.send(new ListQueuesCommand({ MaxResults: 1 }));
		return { success: true, error: "" };
	} catch (error) {
		if ((error as { name?: string }).name === "AccessDenied") return { success: true, error: "" };
		return { success: false, error: describeSqsError(error) };
	} finally {
		client.destroy();
	}
}

/** Only an existing queue answers with anything but this; retrying cannot bring it back. */
export function isQueueGone(error: unknown) {
	const { name, Code } = error as { name?: string; Code?: string };
	return name === "QueueDoesNotExist" || Code === "AWS.SimpleQueueService.NonExistentQueue";
}

/** SDK errors in words a user can act on; the SDK's own text is kept for anything unmapped. */
export function describeSqsError(error: unknown, queueUrl?: string) {
	const { name = "", message, code } = error as { name?: string; message?: string; code?: string };
	const queue = queueUrl ? `"${queueUrl.split("/").pop()}"` : "the queue";
	if (isQueueGone(error)) return `Queue ${queue} does not exist. Create it in SQS first, and check the region and queue URL.`;
	if (name === "InvalidClientTokenId" || name === "UnrecognizedClientException") return "AWS does not recognise the access key ID.";
	if (name === "SignatureDoesNotMatch" || name === "IncompleteSignature") return "AWS rejected the secret access key.";
	if (name === "ExpiredToken" || name === "ExpiredTokenException") return "The session token has expired.";
	if (name === "AccessDenied" || name === "AccessDeniedException")
		return `These credentials may not use ${queue}. They need sqs:GetQueueAttributes, ReceiveMessage, DeleteMessage and ChangeMessageVisibility on it.`;
	if (name === "CredentialsProviderError") return "No AWS credentials: enter an access key, or run the server with an IAM role.";
	if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ConnectionRefused")
		return `Could not reach SQS (${code}). Check the region and endpoint.`;
	// a refused connection can come back with an empty message and only a code
	return message || code || name || String(error);
}
