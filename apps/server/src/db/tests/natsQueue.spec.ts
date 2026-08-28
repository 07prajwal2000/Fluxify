import { describe, it, expect, mock, beforeEach } from "bun:test";
import { AckPolicy, JSONCodec, RetentionPolicy, type JsMsg } from "nats";

const codec = JSONCodec<unknown>();

/* ------------------------------------------------------------------ fake JS */

type Published = { subject: string; data: unknown; opts: any };
const published: Published[] = [];
let duplicate = false;
const streamCalls: any[] = [];
const consumerCalls: any[] = [];
let streamAddFails = false;
/** messages the fake consumer will deliver */
let inbox: JsMsg[] = [];
let closed = false;

/** A JsMsg stub that records what the queue did to it. */
function fakeMsg(subject: string, body: unknown): JsMsg & { acks: string[] } {
	const acks: string[] = [];
	return {
		subject,
		data: codec.encode(body),
		acks,
		ack: () => acks.push("ack"),
		nak: (delay?: number) => acks.push(`nak:${delay}`),
		term: () => acks.push("term"),
	} as unknown as JsMsg & { acks: string[] };
}

// Spread the real module: `mock.module` replaces it for every test file in the
// run, and `pubsub.ts` imports `closeNats`/`initializeNats` from it.
const actualNats = await import("../nats");

mock.module("../nats", () => ({
	...actualNats,
	natsConnection: () => ({
		jetstream: () => ({
			publish: async (subject: string, data: Uint8Array, opts: any) => {
				published.push({ subject, data: codec.decode(data), opts });
				return { duplicate };
			},
			consumers: {
				get: async () => ({
					consume: async (opts: any) => {
						consumerCalls.push(opts);
						return Object.assign(
							(async function* () {
								for (const m of inbox) yield m;
							})(),
							{ close: async () => void (closed = true) },
						);
					},
				}),
			},
		}),
		jetstreamManager: async () => ({
			streams: {
				add: async (cfg: any) => {
					streamCalls.push(cfg);
					if (streamAddFails) throw new Error("stream exists");
				},
				update: async (name: string, cfg: any) =>
					streamCalls.push({ update: name, ...cfg }),
			},
			consumers: {
				add: async (stream: string, cfg: any) =>
					consumerCalls.push({ stream, ...cfg }),
			},
		}),
	}),
}));

const { ensureWorkQueue, publishJob, consumeJobs, createSemaphore } =
	await import("../natsQueue");

const SPEC = {
	stream: "TEST_STREAM",
	subjects: ["test.>"],
	consumer: "test_consumer",
};

/** the consume loop runs detached; let its microtasks drain */
const settle = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
	published.length = 0;
	streamCalls.length = 0;
	consumerCalls.length = 0;
	duplicate = false;
	streamAddFails = false;
	closed = false;
	inbox = [];
});

describe("ensureWorkQueue", () => {
	it("creates a work-queue stream and an explicit-ack durable consumer", async () => {
		await ensureWorkQueue({ ...SPEC, maxDeliver: 1, dedupeWindowMs: 2000 });

		expect(streamCalls[0]).toMatchObject({
			name: "TEST_STREAM",
			subjects: ["test.>"],
			retention: RetentionPolicy.Workqueue,
			duplicate_window: 2_000_000_000, // ms -> ns
		});
		expect(consumerCalls[0]).toMatchObject({
			stream: "TEST_STREAM",
			durable_name: "test_consumer",
			ack_policy: AckPolicy.Explicit,
			max_deliver: 1,
		});
	});

	it("updates the subject list when the stream already exists", async () => {
		streamAddFails = true;

		await ensureWorkQueue(SPEC);

		expect(streamCalls[1]).toMatchObject({
			update: "TEST_STREAM",
			subjects: ["test.>"],
		});
	});
});

describe("publishJob", () => {
	it("passes the idempotency key as Nats-Msg-Id", async () => {
		const accepted = await publishJob("test.a", { hello: 1 }, { msgId: "k1" });

		expect(accepted).toBe(true);
		expect(published[0]).toMatchObject({
			subject: "test.a",
			data: { hello: 1 },
			opts: { msgID: "k1" },
		});
	});

	it("reports false when the server dropped the publish as a duplicate", async () => {
		duplicate = true;

		expect(await publishJob("test.a", {}, { msgId: "k1" })).toBe(false);
	});

	it("omits the header entirely when no key is given", async () => {
		await publishJob("test.a", {});

		expect(published[0].opts.msgID).toBeUndefined();
	});
});

describe("consumeJobs", () => {
	it("decodes the payload and acks after the handler on the default mode", async () => {
		const msg = fakeMsg("test.a", { n: 1 });
		inbox = [msg];
		const seen: unknown[] = [];

		await consumeJobs(SPEC, async (job) => void seen.push(job.data));
		await settle();

		expect(seen).toEqual([{ n: 1 }]);
		expect(msg.acks).toEqual(["ack"]);
	});

	it("acks before the handler runs in on-dispatch mode", async () => {
		const msg = fakeMsg("test.a", {});
		inbox = [msg];
		let ackedBeforeHandler = false;

		await consumeJobs(
			SPEC,
			async () => {
				ackedBeforeHandler = msg.acks.length === 1;
			},
			{ ack: "on-dispatch" },
		);
		await settle();

		expect(ackedBeforeHandler).toBe(true);
		expect(msg.acks).toEqual(["ack"]); // and not acked a second time after
	});

	it("terms a failed job when there is no delivery left to retry with", async () => {
		const msg = fakeMsg("test.a", {});
		inbox = [msg];

		await consumeJobs(SPEC, async () => {
			throw new Error("boom");
		});
		await settle();

		expect(msg.acks).toEqual(["term"]);
	});

	it("naks a failed job when redelivery is allowed", async () => {
		const msg = fakeMsg("test.a", {});
		inbox = [msg];

		await consumeJobs(
			{ ...SPEC, maxDeliver: 3 },
			async () => {
				throw new Error("boom");
			},
			{ nakDelayMs: 1234 },
		);
		await settle();

		expect(msg.acks).toEqual(["nak:1234"]);
	});

	it("reports the failure to onError without killing the consumer", async () => {
		inbox = [fakeMsg("test.a", { n: 1 }), fakeMsg("test.b", { n: 2 })];
		const errors: string[] = [];

		await consumeJobs(
			SPEC,
			async (job) => {
				throw new Error(`failed ${(job.data as any).n}`);
			},
			{ onError: (e) => errors.push(String(e)) },
		);
		await settle();

		expect(errors).toEqual(["Error: failed 1", "Error: failed 2"]);
	});

	it("never runs more handlers at once than the concurrency allows", async () => {
		inbox = Array.from({ length: 10 }, (_, i) => fakeMsg("test.a", { i }));
		let running = 0;
		let peak = 0;
		const release: Array<() => void> = [];

		await consumeJobs(
			SPEC,
			async () => {
				running++;
				peak = Math.max(peak, running);
				await new Promise<void>((r) => release.push(r));
				running--;
			},
			{ concurrency: 3, ack: "on-dispatch" },
		);
		await settle();

		expect(peak).toBe(3);
		// only the first 3 were dispatched; the rest wait in the stream
		expect(release).toHaveLength(3);

		release.splice(0, 3).forEach((r) => r());
		await settle();
		expect(peak).toBe(3);
	});

	it("sizes the pull buffer to the concurrency", async () => {
		await consumeJobs(SPEC, async () => {}, { concurrency: 7 });

		expect(consumerCalls.at(-1)).toMatchObject({ max_messages: 7 });
	});

	it("stops delivery when the returned stop function is called", async () => {
		const stop = await consumeJobs(SPEC, async () => {});

		await stop();

		expect(closed).toBe(true);
	});
});

describe("createSemaphore", () => {
	it("hands a released slot to the waiter instead of letting a newcomer steal it", async () => {
		const sem = createSemaphore(1);
		await sem.acquire();

		const order: string[] = [];
		const waiter = sem.acquire().then(() => order.push("waiter"));
		sem.release();
		// a newcomer arriving in the same tick must not get in first
		const newcomer = sem.acquire().then(() => order.push("newcomer"));

		await waiter;
		expect(order).toEqual(["waiter"]);
		expect(sem.active).toBe(1);

		sem.release();
		await newcomer;
		expect(order).toEqual(["waiter", "newcomer"]);
	});

	it("drops back to zero once every slot is released", async () => {
		const sem = createSemaphore(2);
		await sem.acquire();
		await sem.acquire();

		sem.release();
		sem.release();

		expect(sem.active).toBe(0);
	});
});
