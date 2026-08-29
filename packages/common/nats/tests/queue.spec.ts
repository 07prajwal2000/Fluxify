import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as jetstreamModule from "@nats-io/jetstream";
import type { JsMsg } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import { jsonCodec } from "../codec";

/* --------------------------------------------------------- fake JetStream */

const codec = jsonCodec<unknown>();

type Publish = { subject: string; data: Uint8Array; opts: Record<string, unknown> };
const published: Publish[] = [];
let duplicate = false;
/** what the fake consumer will deliver on the next `consumeQueue` */
let inbox: JsMsg[] = [];
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
		}),
	},
};

mock.module("@nats-io/jetstream", () => ({
	...jetstreamModule,
	jetstream: () => fakeJs,
}));

const { consumeQueue, publishToStream } = await import("../queue");

const nc = {} as NatsConnection;

/** Lets the detached consume loop drain before assertions. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
	published.length = 0;
	duplicate = false;
	inbox = [];
	closed = false;
});

/* ---------------------------------------------------------------- publish */

describe("publishToStream", () => {
	it("encodes the payload and reports the sequence", async () => {
		const result = await publishToStream(nc, "a.b", { hello: 1 });
		expect(result).toEqual({ seq: 1, duplicate: false });
		expect(codec.decode(published[0]!.data)).toEqual({ hello: 1 });
		expect(published[0]!.opts).toEqual({});
	});

	it("passes msgId through as the broker's dedupe key", async () => {
		await publishToStream(nc, "a.b", {}, { msgId: "job-1" });
		expect(published[0]!.opts).toEqual({ msgID: "job-1" });
	});

	it("surfaces a duplicate rather than pretending the publish landed", async () => {
		duplicate = true;
		expect((await publishToStream(nc, "a.b", {})).duplicate).toBe(true);
	});
});

/* ---------------------------------------------------------------- consume */

describe("consumeQueue", () => {
	it("acks after the handler resolves", async () => {
		const msg = fakeMsg("a.b", { n: 1 });
		inbox = [msg];
		const seen: unknown[] = [];
		await consumeQueue(nc, "S", "d", async (m) => void seen.push(m.data));
		await settled();
		expect(seen).toEqual([{ n: 1 }]);
		expect(msg.acks).toEqual(["ack"]);
	});

	it("acks before the handler under on-dispatch", async () => {
		const msg = fakeMsg("a.b", {});
		inbox = [msg];
		await consumeQueue(nc, "S", "d", async () => {
			// the ack has already happened by the time we get here
			expect(msg.acks).toEqual(["ack"]);
		}, { ack: "on-dispatch" });
		await settled();
		expect(msg.acks).toEqual(["ack"]);
	});

	it("retries a failure while attempts remain", async () => {
		const msg = fakeMsg("a.b", {}, 1);
		inbox = [msg];
		await consumeQueue(nc, "S", "d", async () => {
			throw new Error("transient");
		}, { maxAttempts: 3, retryDelayMs: 1234 });
		await settled();
		expect(msg.acks).toEqual(["nak:1234"]);
	});

	it("terminates once the attempts are used up", async () => {
		const msg = fakeMsg("a.b", {}, 3);
		inbox = [msg];
		await consumeQueue(nc, "S", "d", async () => {
			throw new Error("still failing");
		}, { maxAttempts: 3 });
		await settled();
		expect(msg.acks).toEqual(["term"]);
	});

	it("terminates a permanent failure on the first attempt", async () => {
		const msg = fakeMsg("a.b", {}, 1);
		inbox = [msg];
		await consumeQueue(nc, "S", "d", async () => {
			const error = new Error("nobody handles this kind");
			error.name = "UnknownJobKindError";
			throw error;
		}, {
			maxAttempts: 5,
			isPermanent: (error) => (error as Error).name === "UnknownJobKindError",
		});
		await settled();
		expect(msg.acks).toEqual(["term"]);
	});

	it("terminates an undecodable message instead of redelivering it forever", async () => {
		const msg = corruptMsg("a.b");
		inbox = [msg];
		const errors: unknown[] = [];
		await consumeQueue(nc, "S", "d", async () => {}, {
			maxAttempts: 5,
			onError: (error) => errors.push(error),
		});
		await settled();
		expect(msg.acks).toEqual(["term"]);
		expect(errors).toHaveLength(1);
	});

	it("acks a failure under the drop policy", async () => {
		const msg = fakeMsg("a.b", {});
		inbox = [msg];
		await consumeQueue(nc, "S", "d", async () => {
			throw new Error("no destination configured");
		}, { failure: "drop", maxAttempts: 5 });
		await settled();
		expect(msg.acks).toEqual(["ack"]);
	});

	it("reports the delivery attempt to the handler", async () => {
		inbox = [fakeMsg("a.b", {}, 4)];
		let attempt = 0;
		let redelivered = false;
		await consumeQueue(nc, "S", "d", async (m) => {
			attempt = m.attempt;
			redelivered = m.redelivered;
		});
		await settled();
		expect(attempt).toBe(4);
		expect(redelivered).toBe(true);
	});

	it("stops delivery on request", async () => {
		inbox = [];
		const consumer = await consumeQueue(nc, "S", "d", async () => {});
		await consumer.stop();
		expect(closed).toBe(true);
	});
});
