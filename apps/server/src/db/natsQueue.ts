import { logger } from "@fluxify/common";
import {
	AckPolicy,
	JSONCodec,
	RetentionPolicy,
	type ConsumerMessages,
	type JsMsg,
} from "nats";
import { natsConnection } from "./nats";

/**
 * A JetStream work queue: durable job delivery for anything that must survive a
 * restart and be handled exactly once. The compile pipeline hand-rolled this
 * shape first (see `modules/compiler/consumer.ts`); this is the same thing with
 * the knobs that differ between queues pulled out, so a second queue is a
 * config object rather than another copy of the ensure/consume dance.
 *
 * What it is NOT: a general pub/sub (that's `pubsub.ts`) or a request/response
 * bus (that's `natsRpc.ts`). Work queue retention means a message is *removed*
 * once acked, so exactly one consumer gets each job.
 */

const codec = JSONCodec<unknown>();
const MS_TO_NS = 1_000_000;

export interface WorkQueueSpec {
	/** JetStream stream name, e.g. `FLUXIFY_HARNESS`. */
	stream: string;
	/** Subjects the stream captures, e.g. `["fluxify.harness.>"]`. */
	subjects: string[];
	/** Durable pull-consumer name. Shared across replicas — that IS the load balancing. */
	consumer: string;
	/**
	 * Delivery attempts per message. Default 1: a job that dies with its worker
	 * is NOT retried. Raise it only for handlers that are safe to re-run from
	 * the top.
	 */
	maxDeliver?: number;
	/** How long a message may go unacked before redelivery. Default 60s. */
	ackWaitMs?: number;
	/** How long an unhandled job stays in the stream. Default 24h. */
	maxAgeMs?: number;
	/**
	 * Server-side dedupe window for `Nats-Msg-Id`. A publish carrying a msgId
	 * seen within this window is dropped and its ack comes back `duplicate`.
	 * Default 0 (off).
	 */
	dedupeWindowMs?: number;
}

export interface QueueJob<T> {
	subject: string;
	data: T;
	/** Raw message — for `msg.redelivered`, headers, or a manual ack. */
	msg: JsMsg;
}

export interface ConsumeOptions<T> {
	/** Max handlers running at once. Also the pull buffer size. Default 1. */
	concurrency?: number;
	/**
	 * - `on-dispatch`: ack as soon as a concurrency slot is taken, before the
	 *   handler runs. The right choice when `maxDeliver` is 1 — the job will
	 *   never be redelivered anyway, and it means a handler that runs for
	 *   minutes never has to heartbeat `msg.working()` to hold its ack.
	 * - `on-complete` (default): ack after the handler resolves; on a throw the
	 *   message is naked (redelivered) or termed, per `maxDeliver`.
	 */
	ack?: "on-dispatch" | "on-complete";
	/** Redelivery delay after a failed handler, when `maxDeliver > 1`. Default 5s. */
	nakDelayMs?: number;
	/** Called on a handler throw, after the ack/nak decision. */
	onError?: (error: unknown, job: QueueJob<T>) => void;
}

/**
 * Creates the stream and durable consumer if they don't exist. Idempotent, so
 * every process that touches the queue can call it at startup.
 */
export async function ensureWorkQueue(spec: WorkQueueSpec): Promise<void> {
	const jsm = await natsConnection().jetstreamManager();

	try {
		await jsm.streams.add({
			name: spec.stream,
			subjects: spec.subjects,
			// work queue: acked jobs are removed, so a restart never replays
			// everything ever asked for
			retention: RetentionPolicy.Workqueue,
			max_age: (spec.maxAgeMs ?? 24 * 60 * 60 * 1000) * MS_TO_NS,
			duplicate_window: (spec.dedupeWindowMs ?? 0) * MS_TO_NS,
		});
	} catch {
		// exists — keep the subject list current, leave the rest alone
		await jsm.streams.update(spec.stream, { subjects: spec.subjects });
	}

	try {
		await jsm.consumers.add(spec.stream, {
			durable_name: spec.consumer,
			ack_policy: AckPolicy.Explicit,
			ack_wait: (spec.ackWaitMs ?? 60_000) * MS_TO_NS,
			max_deliver: spec.maxDeliver ?? 1,
		});
	} catch {
		// already exists
	}
}

/**
 * Publishes a job. Returns false when the server recognised `msgId` as a
 * duplicate within the stream's dedupe window and dropped it — callers that
 * care can treat that as "someone already queued this".
 */
export async function publishJob<T>(
	subject: string,
	data: T,
	opts: { msgId?: string } = {},
): Promise<boolean> {
	const ack = await natsConnection()
		.jetstream()
		.publish(subject, codec.encode(data), {
			...(opts.msgId ? { msgID: opts.msgId } : {}),
		});
	return !ack.duplicate;
}

/**
 * Starts consuming. Returns a stop function that halts delivery; in-flight
 * handlers are left to finish.
 */
export async function consumeJobs<T>(
	spec: WorkQueueSpec,
	handler: (job: QueueJob<T>) => Promise<void>,
	opts: ConsumeOptions<T> = {},
): Promise<() => Promise<void>> {
	const concurrency = Math.max(1, opts.concurrency ?? 1);
	const ackMode = opts.ack ?? "on-complete";
	const slots = createSemaphore(concurrency);

	const consumer = await natsConnection()
		.jetstream()
		.consumers.get(spec.stream, spec.consumer);
	const messages: ConsumerMessages = await consumer.consume({
		max_messages: concurrency,
	});

	(async () => {
		for await (const msg of messages) {
			// Backpressure: with every slot busy we stop pulling, and the job stays
			// in the stream instead of piling up in this process's heap.
			await slots.acquire();
			if (ackMode === "on-dispatch") msg.ack();
			void run(msg).finally(() => slots.release());
		}
	})();

	async function run(msg: JsMsg) {
		const job: QueueJob<T> = {
			subject: msg.subject,
			data: codec.decode(msg.data) as T,
			msg,
		};
		try {
			await handler(job);
			if (ackMode === "on-complete") msg.ack();
		} catch (error) {
			if (ackMode === "on-complete") {
				// nothing left to retry with when max_deliver is 1 — term, so the
				// message leaves the queue instead of waiting out its ack_wait
				if ((spec.maxDeliver ?? 1) > 1) msg.nak(opts.nakDelayMs ?? 5000);
				else msg.term();
			}
			logger.error(
				`[${spec.stream}] ${msg.subject} failed: ${String(error)}`,
				"NATS_QUEUE",
			);
			opts.onError?.(error, job);
		}
	}

	logger.info(
		`[${spec.stream}] consuming as ${spec.consumer} (concurrency ${concurrency}, ack ${ackMode})`,
		"NATS_QUEUE",
	);

	return async () => {
		await messages.close();
	};
}

/**
 * Counting semaphore. `release` hands the slot straight to the next waiter
 * rather than decrementing — decrementing first would let a fresh `acquire`
 * steal the slot before the waiter resumes, putting the pool over its limit.
 */
export function createSemaphore(limit: number) {
	let active = 0;
	const waiting: Array<() => void> = [];

	return {
		async acquire(): Promise<void> {
			if (active < limit) {
				active++;
				return;
			}
			await new Promise<void>((resolve) => waiting.push(resolve));
		},
		release(): void {
			const next = waiting.shift();
			if (next) next();
			else active--;
		},
		get active() {
			return active;
		},
	};
}
