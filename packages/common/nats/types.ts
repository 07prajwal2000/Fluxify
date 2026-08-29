/**
 * Shared shapes for the NATS library. Every option here is expressed in
 * milliseconds and plain string unions rather than the client's own enums and
 * nanosecond fields: callers describe intent, and the adapters in `stream.ts`
 * do the translation once. That keeps a client upgrade to this directory.
 */

export type Millis = number;

export type StreamRetention = "workqueue" | "limits" | "interest";
export type StreamDiscard = "old" | "new";
export type StreamStorage = "file" | "memory";

export interface StreamSpec {
	/** Stream name, e.g. `FLUXIFY_JOBS`. */
	name: string;
	/** Subjects the stream captures, e.g. `["fluxify.jobs.>"]`. */
	subjects: string[];
	/**
	 * - `workqueue`: an acked message is removed, so exactly one consumer gets
	 *   each message and a restart never replays finished work. Consumer filters
	 *   on such a stream must not overlap — the server refuses the second one.
	 * - `limits` (default): messages age out by the limits below, and any number
	 *   of consumers can read the same subject.
	 */
	retention?: StreamRetention;
	storage?: StreamStorage;
	/** How long a message stays before the server drops it. */
	maxAgeMs?: Millis;
	/** Hard cap on stream size; pair with `discard`. */
	maxBytes?: number;
	/** What gives when a limit is hit. `old` drops the oldest. */
	discard?: StreamDiscard;
	/**
	 * Server-side dedupe window for `Nats-Msg-Id`. A publish carrying an id seen
	 * within this window is dropped and its ack comes back `duplicate`.
	 */
	duplicateWindowMs?: Millis;
	/** Required before per-message TTL headers are honoured. */
	allowMsgTtl?: boolean;
	/** Required before ADR-51 message schedule headers are honoured. */
	allowMsgSchedules?: boolean;
}

export interface ConsumerSpec {
	/** Durable pull-consumer name. Shared across replicas — that IS the load balancing. */
	durable: string;
	/**
	 * Subjects this consumer receives. Omit to take everything on the stream.
	 * More than one requires NATS 2.10+.
	 */
	filterSubjects?: string[];
	/** How long a message may go unacked before redelivery. Default 60s. */
	ackWaitMs?: Millis;
	/** Delivery attempts per message. Default 1 — no retry. */
	maxDeliver?: number;
	/** Unacked messages the server will have in flight at once. */
	maxAckPending?: number;
}
