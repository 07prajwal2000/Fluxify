import { mock } from "bun:test";
import * as jetstreamModule from "@nats-io/jetstream";
import type { JsMsg } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import { jsonCodec } from "../codec";

/**
 * One fake JetStream, shared by the queue specs.
 *
 * It lives here rather than in either spec because both drive the same seam,
 * and a second copy is a second thing to keep honest — the fetch stub in
 * particular, which happily accepted argument combinations the real client
 * rejects.
 */

const codec = jsonCodec<unknown>();

type Publish = { subject: string; data: Uint8Array; opts: Record<string, unknown> };
const published: Publish[] = [];
let duplicate = false;
/** what the fake consumer will deliver on the next `consumeQueue` */
let inbox: JsMsg[] = [];
/** what each successive `fetch` returns, for `consumeBatches` */
let batches: JsMsg[][] = [];
/** the options every `fetch` was called with */
let fetches: Record<string, unknown>[] = [];
let closed = false;

/** A `JsMsg` stub that records what the queue decided to do with it. */
function fakeMsg(
	subject: string,
	body: unknown,
	deliveryCount = 1,
): JsMsg & { acks: string[] } {
	const acks: string[] = [];
	return {
		subject,
		data: codec.encode(body),
		redelivered: deliveryCount > 1,
		headers: undefined,
		info: { deliveryCount },
		acks,
		ack: () => acks.push("ack"),
		nak: (delay?: number) => acks.push(`nak:${delay}`),
		term: () => acks.push("term"),
	} as unknown as JsMsg & { acks: string[] };
}

/** Raw bytes that are not JSON, so decoding throws inside the consumer. */
function corruptMsg(subject: string): JsMsg & { acks: string[] } {
	const msg = fakeMsg(subject, null);
	(msg as { data: Uint8Array }).data = new Uint8Array([0x7b, 0x7b, 0x7b]);
	return msg;
}

const fakeJs = {
	publish: async (subject: string, data: Uint8Array, opts: Record<string, unknown>) => {
		published.push({ subject, data, opts });
		return { seq: published.length, duplicate };
	},
	consumers: {
		get: async () => ({
			consume: async () => {
				const messages = inbox;
				return {
					close: async () => {
						closed = true;
					},
					async *[Symbol.asyncIterator]() {
						for (const msg of messages) yield msg;
					},
				};
			},
			fetch: async (opts: Record<string, unknown>) => {
				fetches.push(opts);
				const messages = batches.shift() ?? [];
				return {
					async *[Symbol.asyncIterator]() {
						for (const msg of messages) yield msg;
					},
				};
			},
		}),
	},
};

mock.module("@nats-io/jetstream", () => ({
	...jetstreamModule,
	jetstream: () => fakeJs,
}));

export const state = {
	get published() {
		return published;
	},
	get fetches() {
		return fetches;
	},
	get closed() {
		return closed;
	},
	setDuplicate(value: boolean) {
		duplicate = value;
	},
	setInbox(messages: JsMsg[]) {
		inbox = messages;
	},
	setBatches(next: JsMsg[][]) {
		batches = next;
	},
	reset() {
		published.length = 0;
		duplicate = false;
		inbox = [];
		batches = [];
		fetches.length = 0;
		closed = false;
	},
};

export { fakeMsg, corruptMsg };

export const nc = {} as NatsConnection;

/** Lets the detached consume loop drain before assertions. */
export const settled = () => new Promise((resolve) => setTimeout(resolve, 5));
