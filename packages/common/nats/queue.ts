import { jetstream, type JsMsg } from "@nats-io/jetstream";
import type { MsgHdrs, NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { type Codec, jsonCodec } from "./codec";
import { createSemaphore } from "./concurrency";

/**
 * Durable job delivery on top of a JetStream stream. Provisioning lives in
 * `stream.ts`; this file is only publish and consume, and the ack decision that
 * sits between the handler and the broker.
 *
 * Every consumer in the codebase used to hand-roll that decision, which is how
 * three of them ended up with three different answers to "what happens on the
 * fifth failure". There is one answer here, and a policy flag for the case that
 * genuinely differs.
 */

export interface PublishOptions {
	/**
	 * `Nats-Msg-Id`. Publishing the same id twice inside the stream's dedupe
	 * window enqueues the work once, and the second ack comes back `duplicate`.
	 */
	msgId?: string;
	headers?: MsgHdrs;
}

export interface PublishResult {
	seq: number;
	/** True when the server recognised `msgId` and dropped this publish. */
	duplicate: boolean;
}

/**
 * Publishes and waits for the stream's ack, so a resolved promise means the
 * message is persisted. Throws on failure — a caller that asked for durable
 * work is worse served by a queue that swallows the error.
 */
export async function publishToStream<T>(
	nc: NatsConnection,
	subject: string,
	data: T,
	options: PublishOptions & { codec?: Codec<T> } = {},
): Promise<PublishResult> {
	const codec = options.codec ?? jsonCodec<T>();
	const ack = await jetstream(nc).publish(subject, codec.encode(data), {
		...(options.msgId ? { msgID: options.msgId } : {}),
		...(options.headers ? { headers: options.headers } : {}),
	});
	return { seq: ack.seq, duplicate: ack.duplicate };
}

export interface QueueMessage<T> {
	subject: string;
	data: T;
	/** Delivery attempt, starting at 1. */
	attempt: number;
	redelivered: boolean;
	headers: MsgHdrs | undefined;
	/** The raw message, for anything this wrapper does not cover. */
	msg: JsMsg;
}

export interface ConsumeOptions<T> {
	/** Handlers running at once, and the server-side pull buffer. Default 1. */
	concurrency?: number;
	/**
	 * - `on-complete` (default): ack after the handler resolves.
	 * - `on-dispatch`: ack as soon as a slot is taken, before the handler runs.
	 *   The right choice when the consumer's `maxDeliver` is 1 — the message
	 *   will never come back anyway, and it means a handler that runs for
	 *   minutes never has to call `msg.working()` to hold its ack.
	 */
	ack?: "on-dispatch" | "on-complete";
	/**
	 * What a thrown handler means.
	 * - `retry` (default): redeliver until the consumer's `maxDeliver`, then
	 *   terminate. Use where not running the work is a broken product.
	 * - `drop`: ack anyway. Use where the message has no value once its moment
	 *   has passed — a trace export whose route has long since responded — and
	 *   where a permanent failure would otherwise be a redelivery loop.
	 */
	failure?: "retry" | "drop";
	/** Redelivery delay under `retry`. Default 5s. */
	retryDelayMs?: number;
	/**
	 * Attempts before `retry` gives up and terminates. Should match the
	 * consumer's `maxDeliver`; the broker enforces the real limit, this just
	 * lets us log the give-up rather than watch it vanish.
	 */
	maxAttempts?: number;
	/**
	 * Failures that will fail identically forever — an unparseable payload, a
	 * job kind nobody handles. Terminated on the first attempt instead of
	 * burning the retry budget.
	 */
	isPermanent?: (error: unknown) => boolean;
	/** Called after the ack decision, for metrics or a dead-letter record. */
	onError?: (error: unknown, message: QueueMessage<T> | undefined) => void;
	codec?: Codec<T>;
}

export interface QueueConsumer {
	/** Stops delivery. In-flight handlers are left to finish. */
	stop(): Promise<void>;
}

/**
 * Starts consuming a durable pull consumer. The consumer must already exist —
 * call `ensureStreamConsumer` at startup.
 */
export async function consumeQueue<T>(
	nc: NatsConnection,
	stream: string,
	durable: string,
	handler: (message: QueueMessage<T>) => Promise<void>,
	options: ConsumeOptions<T> = {},
): Promise<QueueConsumer> {
	const concurrency = Math.max(1, options.concurrency ?? 1);
	const ackMode = options.ack ?? "on-complete";
	const failure = options.failure ?? "retry";
	const retryDelayMs = options.retryDelayMs ?? 5_000;
	const codec = options.codec ?? jsonCodec<T>();
	const label = `${stream}/${durable}`;

	const consumer = await jetstream(nc).consumers.get(stream, durable);
	const messages = await consumer.consume({ max_messages: concurrency });
	const slots = createSemaphore(concurrency);

	void (async () => {
		for await (const msg of messages) {
			// Backpressure: with every slot busy we stop pulling, so the backlog
			// stays in the stream instead of piling up in this process's heap.
			await slots.acquire();
			if (ackMode === "on-dispatch") msg.ack();
			void settle(msg).finally(() => slots.release());
		}
	})();

	async function settle(msg: JsMsg): Promise<void> {
		let message: QueueMessage<T> | undefined;
		try {
			message = {
				subject: msg.subject,
				data: codec.decode(msg.data),
				attempt: msg.info.deliveryCount,
				redelivered: msg.redelivered,
				headers: msg.headers,
				msg,
			};
			await handler(message);
			if (ackMode === "on-complete") msg.ack();
		} catch (error) {
			if (ackMode === "on-complete") {
				decide(msg, message, error);
			} else {
				logger.error(`[nats] ${label} ${msg.subject} failed after ack: ${String(error)}`, "NATS");
			}
			options.onError?.(error, message);
		}
	}

	/**
	 * The ack decision, in one place. A decode failure lands here with
	 * `message` undefined, which is itself permanent: the same bytes will fail
	 * the same way on every redelivery.
	 */
	function decide(msg: JsMsg, message: QueueMessage<T> | undefined, error: unknown) {
		const where = `${label} ${msg.subject}`;
		if (failure === "drop") {
			logger.error(`[nats] dropping ${where}: ${String(error)}`, "NATS");
			return msg.ack();
		}
		if (!message || options.isPermanent?.(error)) {
			logger.error(`[nats] terminating ${where}: ${String(error)}`, "NATS");
			return msg.term();
		}
		const attempts = options.maxAttempts ?? 1;
		if (message.attempt >= attempts) {
			logger.error(
				`[nats] ${where} failed ${message.attempt} times, giving up: ${String(error)}`,
				"NATS",
			);
			return msg.term();
		}
		logger.warn(
			`[nats] ${where} failed (attempt ${message.attempt}), retrying: ${String(error)}`,
			"NATS",
		);
		msg.nak(retryDelayMs);
	}

	logger.info(
		`[nats] consuming ${label} (concurrency ${concurrency}, ack ${ackMode}, failure ${failure})`,
		"NATS",
	);

	return {
		stop: async () => {
			await messages.close();
		},
	};
}
