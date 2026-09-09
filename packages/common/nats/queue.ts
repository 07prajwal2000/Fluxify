import { jetstream, type JsMsg } from "@nats-io/jetstream";
import type { MsgHdrs, NatsConnection } from "@nats-io/nats-core";
import { logger } from "../logging";
import { type Codec, jsonCodec } from "./codec";
import { createSemaphore } from "./concurrency";
import type { Millis } from "./types";

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

/* ----------------------------------------------------------------- batches */

/** The client refuses a fetch that would expire sooner than this. */
const MIN_EXPIRES_MS = 1_000;

export interface BatchOptions<T> {
	/** Upper bound on messages in one batch. 1 is queue mode, same code path. */
	maxMessages: number;
	/**
	 * Memory bound on one batch, and NOT optional. A count cap alone is not a
	 * bound: 500 messages of 10MB is an OOM whatever the count says. Applied
	 * while the batch is built; whatever crosses the line is naked back.
	 */
	maxBytes: number;
	/** How long a partial batch waits for the rest. Default 5s. */
	maxWaitMs?: Millis;
	/** Batches in flight. Above 1 forfeits ordering. Default 1. */
	concurrency?: number;
	/** Redelivery delay when the batch is naked. Default 5s. */
	retryDelayMs?: Millis;
	/** Deliveries before the batch is terminated. Should match `maxDeliver`. */
	maxAttempts?: number;
	/** Failures that will fail identically forever. Terminated immediately. */
	isPermanent?: (error: unknown) => boolean;
	/** Called after the ack decision, for metrics or a dead-letter record. */
	onError?: (error: unknown, batch: QueueMessage<T>[]) => void;
	codec?: Codec<T>;
}

/**
 * Pulls messages in batches and hands each batch to the handler as one unit.
 *
 * `fetch` is the batch primitive: it returns as soon as `max_messages` is
 * reached or `expires` elapses, whichever comes first — which is exactly
 * "coalesce up to N events, but never wait longer than T". The byte ceiling is
 * applied as the batch is assembled, because the client refuses a fetch that
 * carries a count limit and a byte limit together.
 *
 * **A batch is one unit of work.** It succeeds and every message is acked, or
 * it fails and every message is naked. There is deliberately no bisect-and-retry
 * for a poison message inside an otherwise good batch: that is a lot of
 * machinery for a failure nobody has reported yet, and it makes the semantics
 * the user has to reason about strictly worse. Size 1 runs this same path, so
 * the batch code is exercised by every ordinary consumer rather than only by
 * the users who opted into batching.
 */
export async function consumeBatches<T>(
	nc: NatsConnection,
	stream: string,
	durable: string,
	handler: (batch: QueueMessage<T>[]) => Promise<void>,
	options: BatchOptions<T>,
): Promise<QueueConsumer> {
	const maxMessages = Math.max(1, options.maxMessages);
	// The broker will not accept a shorter poll, and a wait under a second is
	// not a promise it can keep. A batch that fills early still returns early,
	// so this is only the ceiling on waiting for a partial one.
	const maxWaitMs = Math.max(
		MIN_EXPIRES_MS,
		options.maxWaitMs && options.maxWaitMs > 0 ? options.maxWaitMs : 5_000,
	);
	const concurrency = Math.max(1, options.concurrency ?? 1);
	const retryDelayMs = options.retryDelayMs ?? 5_000;
	const codec = options.codec ?? jsonCodec<T>();
	const label = `${stream}/${durable}`;

	const consumer = await jetstream(nc).consumers.get(stream, durable);
	const slots = createSemaphore(concurrency);
	let running = true;
	const inFlight = new Set<Promise<void>>();

	void (async () => {
		while (running) {
			// Backpressure: with every slot busy we stop fetching, so the backlog
			// stays on the stream rather than in this process's heap.
			await slots.acquire();
			if (!running) {
				slots.release();
				break;
			}
			let batch: QueueMessage<T>[];
			try {
				batch = await pull();
			} catch (error) {
				slots.release();
				if (!running) break;
				logger.error(`[nats] ${label} fetch failed: ${String(error)}`, "NATS");
				// A broker that is down comes back; spinning on it does not help.
				await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
				continue;
			}
			if (!running && batch.length > 0) {
				// A fetch already in flight when stop() was called still resolves,
				// and a withdrawn trigger must not deliver one last batch after
				// it is gone. Nak so the events stay on the stream for whoever
				// picks the trigger up next, rather than being consumed by a
				// consumer that no longer exists.
				for (const message of batch) message.msg.nak();
				slots.release();
				break;
			}
			if (batch.length === 0) {
				slots.release();
				// A real fetch has already waited out `expires` before returning
				// nothing, so this yield costs nothing in production. It matters
				// when a fetch resolves instantly — an empty stream on some
				// brokers, or a stub in a test — where an unbroken microtask loop
				// would starve every timer in the process.
				await new Promise((resolve) => setTimeout(resolve, 0));
				continue;
			}
			const work = settle(batch).finally(() => {
				inFlight.delete(work);
				slots.release();
			});
			inFlight.add(work);
		}
	})();

	/**
	 * One fetch, decoded. A message that cannot be decoded is terminated on the
	 * spot rather than failing its batch: the same bytes fail the same way on
	 * every redelivery, and one corrupt message must not stop the good ones
	 * beside it from running.
	 */
	async function pull(): Promise<QueueMessage<T>[]> {
		// Only one of the two limits may be given: the client rejects a fetch
		// carrying both. The count is the one that goes on the wire, because it
		// is the number the trigger's author actually chose; the byte ceiling is
		// applied here as the batch is assembled, and anything past it is naked
		// so it comes straight back for the next batch rather than waiting out
		// the ack timer.
		// ponytail: the bytes still cross the wire before we drop them, so this
		// bounds the batch we build rather than what the fetch pulls in. It is
		// the batch that gets held in memory alongside the running graph.
		const messages = await consumer.fetch({
			max_messages: maxMessages,
			expires: maxWaitMs,
		});
		const batch: QueueMessage<T>[] = [];
		let bytes = 0;
		for await (const msg of messages) {
			// A batch has to make progress: a single message over the ceiling
			// still goes, or it would nak forever and never be delivered.
			if (batch.length > 0 && bytes + msg.data.length > options.maxBytes) {
				msg.nak();
				continue;
			}
			bytes += msg.data.length;
			try {
				batch.push({
					subject: msg.subject,
					data: codec.decode(msg.data),
					attempt: msg.info.deliveryCount,
					redelivered: msg.redelivered,
					headers: msg.headers,
					msg,
				});
			} catch (error) {
				logger.error(
					`[nats] terminating undecodable ${label} ${msg.subject}: ${String(error)}`,
					"NATS",
				);
				msg.term();
			}
		}
		return batch;
	}

	async function settle(batch: QueueMessage<T>[]): Promise<void> {
		try {
			await handler(batch);
			for (const message of batch) message.msg.ack();
		} catch (error) {
			decide(batch, error);
			options.onError?.(error, batch);
		}
	}

	/** The ack decision for a whole batch, in one place. */
	function decide(batch: QueueMessage<T>[], error: unknown) {
		const where = `${label} (${batch.length} message${batch.length === 1 ? "" : "s"})`;
		// Redelivery is per message, so a batch's attempt count is the highest one
		// in it — the first message to exhaust its budget retires the batch.
		const attempt = Math.max(...batch.map((message) => message.attempt));
		const attempts = options.maxAttempts ?? 1;

		if (options.isPermanent?.(error) || attempt >= attempts) {
			logger.error(
				`[nats] ${where} failed on attempt ${attempt}, giving up: ${String(error)}`,
				"NATS",
			);
			// ponytail: terminate drops the batch. A dead-letter destination is
			// tracked separately; this is where it hooks in.
			for (const message of batch) message.msg.term();
			return;
		}
		logger.warn(
			`[nats] ${where} failed (attempt ${attempt}), retrying: ${String(error)}`,
			"NATS",
		);
		for (const message of batch) message.msg.nak(retryDelayMs);
	}

	logger.info(
		`[nats] consuming ${label} in batches (max ${maxMessages} / ${options.maxBytes}B / ${maxWaitMs}ms, concurrency ${concurrency})`,
		"NATS",
	);

	return {
		stop: async () => {
			running = false;
			await Promise.allSettled([...inFlight]);
		},
	};
}
