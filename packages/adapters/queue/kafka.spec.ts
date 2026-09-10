import { describe, expect, it } from "bun:test";
import type { QueueBatch, QueueHandler, QueueSubscription } from "./base";
import { KafkaConnection } from "./kafka";

/**
 * The batching and redelivery the connector does itself, driven with fake
 * broker messages. Talking to a real broker is the integration spec's job.
 */

const committed: string[] = [];

function message(partition: number, offset: number, value: string | null = `{"n":${offset}}`) {
	return {
		topic: "orders",
		partition,
		offset: BigInt(offset),
		key: Buffer.from(`k${offset}`),
		value: value === null ? null : Buffer.from(value),
		headers: new Map([[Buffer.from("tenant"), Buffer.from("acme")]]),
		timestamp: BigInt(Date.parse("2026-09-10T00:00:00.000Z")),
		commit: async () => void committed.push(`${partition}:${offset}`),
	};
}

function harness(settings: Partial<QueueSubscription>, handler: QueueHandler) {
	const connection = new KafkaConnection({ brokers: "localhost:9092" });
	Object.assign(connection as any, {
		subscription: {
			source: { topics: ["orders"] },
			consumerGroup: "fluxify-t1",
			batchSize: 1,
			maxWaitMs: 0,
			maxBytes: 1024 * 1024,
			concurrency: 1,
			...settings,
		},
		handler,
	});
	return {
		connection,
		receive: (...messages: ReturnType<typeof message>[]) =>
			messages.forEach((m) => (connection as any).receive(m)),
	};
}

async function until(done: () => boolean, ms = 3_000) {
	const deadline = Date.now() + ms;
	while (!done()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await Bun.sleep(5);
	}
}

const offsets = (batch: QueueBatch) =>
	batch.events.map((e) => `${e.partition}:${e.offset}`).join(",");

describe("kafka connection", () => {
	it("sends a full batch at once and a partial one after the wait", async () => {
		const seen: string[] = [];
		const { receive } = harness({ batchSize: 2, maxWaitMs: 30 }, async (batch) => {
			seen.push(offsets(batch));
		});

		receive(message(0, 0), message(0, 1), message(0, 2));

		await until(() => seen.length === 2);
		expect(seen).toEqual(["0:0,0:1", "0:2"]);
	});

	it("keeps a partition in order while other partitions run alongside", async () => {
		const log: string[] = [];
		const { receive } = harness({ concurrency: 2 }, async (batch) => {
			log.push(`start ${offsets(batch)}`);
			await Bun.sleep(20);
			log.push(`end ${offsets(batch)}`);
		});

		receive(message(0, 0), message(0, 1), message(1, 0));

		await until(() => log.length === 6);
		expect(log.slice(0, 2)).toEqual(["start 0:0", "start 1:0"]);
		expect(log.indexOf("start 0:1")).toBeGreaterThan(log.indexOf("end 0:0"));
	});

	it("delivers a batch again when the handler throws", async () => {
		const attempts: string[] = [];
		const { receive } = harness({}, async (batch) => {
			attempts.push(`${offsets(batch)}#${batch.attempt}`);
			if (attempts.length === 1) throw new Error("not yet");
		});

		receive(message(0, 7));

		await until(() => attempts.length === 2);
		expect(attempts).toEqual(["0:7#1", "0:7#1"]);
	});

	it("ignores offsets it already took, as a refetch after a rebalance repeats them", async () => {
		const seen: string[] = [];
		const { receive } = harness({ batchSize: 5, maxWaitMs: 10 }, async (batch) => {
			seen.push(offsets(batch));
		});

		receive(message(0, 0), message(0, 1), message(0, 0), message(0, 1));

		await until(() => seen.length === 1);
		await Bun.sleep(30);
		expect(seen).toEqual(["0:0,0:1"]);
	});

	it("turns a broker message into an event with where it came from", async () => {
		let batch: QueueBatch | undefined;
		const { receive } = harness({ batchSize: 3, maxWaitMs: 10 }, async (b) => {
			batch = b;
		});

		receive(message(2, 5), message(2, 6, "plain text"), message(2, 7, null));

		await until(() => !!batch);
		expect(batch!.consumerGroup).toBe("fluxify-t1");
		expect(batch!.events.map((e) => e.data)).toEqual([{ n: 5 }, "plain text", null]);
		expect(batch!.events[0]).toMatchObject({
			topic: "orders",
			partition: 2,
			offset: "5",
			key: "k5",
			headers: { tenant: "acme" },
			timestamp: "2026-09-10T00:00:00.000Z",
		});
	});

	it("commits a batch at its last offset", async () => {
		committed.length = 0;
		const { connection, receive } = harness({ batchSize: 2 }, async (batch) => {
			await connection.commit(batch);
		});

		receive(message(0, 3), message(0, 4));

		await until(() => committed.length === 1);
		expect(committed).toEqual(["0:4"]);
	});

	it("refuses to dead-letter without a dead-letter topic", async () => {
		const { connection } = harness({}, async () => undefined);
		await expect(
			connection.moveToDLQ({ events: [], consumerGroup: "g", highWatermark: null, attempt: 1 }, "x"),
		).rejects.toThrow(/dead-letter topic/);
	});

	it("stops redelivering once stopped", async () => {
		let calls = 0;
		const { connection, receive } = harness({}, async () => {
			calls++;
			throw new Error("always");
		});

		receive(message(0, 0));
		await until(() => calls === 1);
		const started = Date.now();
		await connection.stop();

		expect(Date.now() - started).toBeLessThan(500);
		await Bun.sleep(50);
		expect(calls).toBe(1);
	});
});
