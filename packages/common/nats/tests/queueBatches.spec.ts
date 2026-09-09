import { beforeEach, describe, expect, it } from "bun:test";
import {
	corruptMsg,
	fakeMsg,
	nc,
	settled,
	state,
} from "./fakeJetstream";

const { consumeBatches } = await import("../queue");

beforeEach(() => state.reset());

/* ---------------------------------------------------------------- batching */

describe("consumeBatches", () => {
	const batchOptions = { maxMessages: 500, maxBytes: 1_000_000, maxWaitMs: 50 };

	it("hands the whole batch to the handler as one call and acks all of it", async () => {
		const msgs = [fakeMsg("t.1", { n: 1 }), fakeMsg("t.1", { n: 2 })];
		state.setBatches([msgs]);
		const seen: unknown[][] = [];
		const consumer = await consumeBatches(nc, "S", "d", async (batch) => {
			seen.push(batch.map((m) => m.data));
		}, batchOptions);
		await settled();
		await consumer.stop();

		expect(seen).toEqual([[{ n: 1 }, { n: 2 }]]);
		expect(msgs.map((m) => m.acks)).toEqual([["ack"], ["ack"]]);
	});

	it("fetches on the count and the wait, never both limits at once", async () => {
		state.setBatches([[]]);
		const consumer = await consumeBatches(nc, "S", "d", async () => {}, batchOptions);
		await settled();
		await consumer.stop();

		// The client rejects a fetch carrying max_messages and max_bytes
		// together: "'max_messages','max_bytes' are mutually exclusive". Sending
		// both took down every trigger consumer at startup.
		expect(state.fetches[0]).toEqual({ max_messages: 500, expires: 1_000 });
		expect(state.fetches[0]).not.toHaveProperty("max_bytes");
	});

	it("raises a sub-second wait to the shortest one the client accepts", async () => {
		state.setBatches([[]]);
		// "'expires' must be at least 1000ms" — a trigger may ask for 0 or 300,
		// and the fetch is rejected outright rather than clamped for us.
		const consumer = await consumeBatches(nc, "S", "d", async () => {}, {
			...batchOptions,
			maxWaitMs: 300,
		});
		await settled();
		await consumer.stop();

		expect(state.fetches[0]!.expires).toBe(1_000);
	});

	it("naks a batch that a fetch delivered after stop, rather than running it", async () => {
		const msgs = [fakeMsg("t.1", { late: true })];
		state.setBatches([msgs]);
		const seen: unknown[][] = [];
		const consumer = await consumeBatches(nc, "S", "d", async (batch) => {
			seen.push(batch);
		}, batchOptions);
		// stop before the loop settles what the first fetch returned
		await consumer.stop();
		await settled();

		// A withdrawn trigger must not deliver one last batch after it is gone;
		// the events stay on the stream for whoever picks it up next.
		expect(seen).toEqual([]);
		expect(msgs[0]!.acks).toEqual(["nak:undefined"]);
	});

	it("stops filling a batch at the byte ceiling and naks the rest", async () => {
		const big = () => fakeMsg("t.1", { blob: "x".repeat(400) });
		const msgs = [big(), big(), big()];
		state.setBatches([msgs]);
		const seen: number[] = [];
		const consumer = await consumeBatches(nc, "S", "d", async (batch) => {
			seen.push(batch.length);
		}, { ...batchOptions, maxBytes: 900 });
		await settled();
		await consumer.stop();

		// Two fit under 900 bytes, the third does not — and it is naked rather
		// than dropped, so the next batch gets it.
		expect(seen).toEqual([2]);
		expect(msgs[0]!.acks).toEqual(["ack"]);
		expect(msgs[1]!.acks).toEqual(["ack"]);
		expect(msgs[2]!.acks).toEqual(["nak:undefined"]);
	});

	it("still delivers a single message that is over the ceiling on its own", async () => {
		const huge = fakeMsg("t.1", { blob: "x".repeat(5_000) });
		state.setBatches([[huge]]);
		const seen: number[] = [];
		const consumer = await consumeBatches(nc, "S", "d", async (batch) => {
			seen.push(batch.length);
		}, { ...batchOptions, maxBytes: 100 });
		await settled();
		await consumer.stop();

		// Refusing it would nak the same message forever.
		expect(seen).toEqual([1]);
		expect(huge.acks).toEqual(["ack"]);
	});

	it("runs a size-1 trigger down the same path", async () => {
		const msg = fakeMsg("t.1", { only: true });
		state.setBatches([[msg]]);
		let sizes: number[] = [];
		const consumer = await consumeBatches(nc, "S", "d", async (batch) => {
			sizes.push(batch.length);
		}, { ...batchOptions, maxMessages: 1 });
		await settled();
		await consumer.stop();

		expect(sizes).toEqual([1]);
		expect(msg.acks).toEqual(["ack"]);
	});

	it("naks the whole batch when the handler throws — no partial success", async () => {
		const msgs = [fakeMsg("t.1", {}), fakeMsg("t.1", {})];
		state.setBatches([msgs]);
		const consumer = await consumeBatches(nc, "S", "d", async () => {
			throw new Error("sink down");
		}, { ...batchOptions, maxAttempts: 5, retryDelayMs: 1_000 });
		await settled();
		await consumer.stop();

		expect(msgs.map((m) => m.acks)).toEqual([["nak:1000"], ["nak:1000"]]);
	});

	it("terminates the whole batch once its deliveries are spent", async () => {
		const msgs = [fakeMsg("t.1", {}, 1), fakeMsg("t.1", {}, 5)];
		state.setBatches([msgs]);
		const errors: unknown[] = [];
		const consumer = await consumeBatches(nc, "S", "d", async () => {
			throw new Error("poison");
		}, { ...batchOptions, maxAttempts: 5, onError: (error) => errors.push(error) });
		await settled();
		await consumer.stop();

		// the highest attempt in the batch retires it, so the first message goes
		// with the one that ran out of budget rather than being redelivered alone
		expect(msgs.map((m) => m.acks)).toEqual([["term"], ["term"]]);
		expect(errors).toHaveLength(1);
	});

	it("terminates an undecodable message without failing the batch around it", async () => {
		const good = fakeMsg("t.1", { n: 1 });
		const bad = corruptMsg("t.1");
		state.setBatches([[bad, good]]);
		const seen: unknown[][] = [];
		const consumer = await consumeBatches(nc, "S", "d", async (batch) => {
			seen.push(batch.map((m) => m.data));
		}, batchOptions);
		await settled();
		await consumer.stop();

		expect(seen).toEqual([[{ n: 1 }]]);
		expect(bad.acks).toEqual(["term"]);
		expect(good.acks).toEqual(["ack"]);
	});
});
