import { describe, expect, it } from "bun:test";
import type { ConsumeMessage } from "amqplib";
import type { QueueBatch, QueueHandler, QueueSubscription } from "./base";
import {
	connectionOptions,
	prefetchFor,
	RabbitMqConnection,
	type RabbitMqEvent,
	rabbitMqWarnings,
	requeueDelayMs,
} from "./rabbitmq";

/**
 * The batching, settling and requeueing the connector does itself, driven with
 * fake deliveries on a fake channel. A real broker is the e2e suite's job.
 */

type Settled = { tag: number; how: string };

function fakeChannel(log: Settled[] = []) {
	return {
		log,
		ack: (m: ConsumeMessage) => void log.push({ tag: m.fields.deliveryTag, how: "ack" }),
		reject: (m: ConsumeMessage, requeue: boolean) =>
			void log.push({ tag: m.fields.deliveryTag, how: requeue ? "reject+requeue" : "reject" }),
		nack: (m: ConsumeMessage, _all: boolean, requeue: boolean) =>
			void log.push({ tag: m.fields.deliveryTag, how: requeue ? "requeue" : "nack" }),
		checkQueue: async () => ({ queue: "orders", messageCount: 7, consumerCount: 1 }),
	};
}

function message(tag: number, body = `{"n":${tag}}`, headers: Record<string, unknown> = {}) {
	return {
		content: Buffer.from(body),
		fields: {
			deliveryTag: tag,
			redelivered: false,
			exchange: "shop",
			routingKey: "order.created",
			consumerTag: "fluxify-t1",
		},
		properties: { headers, messageId: `m${tag}`, contentType: "application/json", timestamp: 1_790_000_000 },
	} as unknown as ConsumeMessage;
}

function harness(settings: Partial<QueueSubscription>, handler: QueueHandler) {
	const connection = new RabbitMqConnection({ source: "url", url: "amqp://localhost" });
	const channel = fakeChannel();
	Object.assign(connection as any, {
		queue: "orders",
		channel,
		subscription: {
			source: { queue: "orders" },
			consumerGroup: "fluxify-t1",
			batchSize: 1,
			maxWaitMs: 0,
			maxBytes: 1024 * 1024,
			concurrency: 1,
			retryDelayMs: 10,
			...settings,
		},
		handler,
	});
	return {
		connection,
		channel,
		receive: (...messages: ConsumeMessage[]) =>
			messages.forEach((m) => (connection as any).receive(m, (connection as any).channel)),
	};
}

async function until(done: () => boolean, ms = 3_000) {
	const deadline = Date.now() + ms;
	while (!done()) {
		if (Date.now() > deadline) throw new Error("timed out");
		await Bun.sleep(5);
	}
}

const tags = (batch: QueueBatch) =>
	batch.events.map((e) => (e as RabbitMqEvent).deliveryTag).join(",");

describe("rabbitmq connection", () => {
	it("sends a full batch at once and a partial one after the wait", async () => {
		const seen: string[] = [];
		const { receive } = harness({ batchSize: 2, maxWaitMs: 30 }, async (batch) => {
			seen.push(tags(batch));
		});

		receive(message(1), message(2), message(3));

		await until(() => seen.length === 2);
		expect(seen).toEqual(["1,2", "3"]);
	});

	it("cuts a batch before it goes over maxBytes, but never into an empty one", async () => {
		const seen: string[] = [];
		const { receive } = harness({ batchSize: 10, maxBytes: 10 }, async (batch) => {
			seen.push(tags(batch));
		});

		receive(message(1, "123456"), message(2, "123456"), message(3, "a-body-over-the-limit"));

		await until(() => seen.length === 3);
		expect(seen).toEqual(["1", "2", "3"]);
	});

	it("acks each message once, however often it is committed", async () => {
		const { connection, channel, receive } = harness({}, async (batch, conn) => {
			await conn.commit(batch);
			await conn.commit(batch);
		});

		receive(message(1));

		await until(() => channel.log.length > 0);
		await Bun.sleep(30);
		expect(channel.log).toEqual([{ tag: 1, how: "ack" }]);
		await connection.stop();
	});

	it("dead-letters by rejecting without requeue, and the commit after it is a no-op", async () => {
		const { channel, receive } = harness({}, async (batch, conn) => {
			await conn.moveToDLQ(batch, new Error("bad order"));
			await conn.commit(batch);
		});

		receive(message(1));

		await until(() => channel.log.length > 0);
		await Bun.sleep(30);
		expect(channel.log).toEqual([{ tag: 1, how: "reject" }]);
	});

	it("requeues a failed or unsettled batch after the retry delay, not at once", async () => {
		let runs = 0;
		const { channel, receive } = harness({ retryDelayMs: 60 }, async () => {
			runs++;
			throw new Error("boom");
		});

		receive(message(1));

		await until(() => runs === 1);
		await Bun.sleep(20);
		expect(channel.log).toEqual([]);
		await until(() => channel.log.length > 0);
		expect(channel.log).toEqual([{ tag: 1, how: "requeue" }]);
	});

	it("skips settling a message whose channel closed, rather than ack its tag on the new one", async () => {
		const { connection, channel, receive } = harness({}, async (batch, conn) => {
			// the connection dropped mid-run and recovery opened a new channel
			(connection as any).channel = fakeChannel();
			await conn.commit(batch);
		});

		receive(message(1));

		await Bun.sleep(40);
		expect(channel.log).toEqual([]);
		expect((connection as any).channel.log).toEqual([]);
	});

	it("hands the workflow the body and RabbitMQ's delivery details", async () => {
		let event: RabbitMqEvent | undefined;
		const { receive } = harness({}, async (batch) => {
			event = batch.events[0] as RabbitMqEvent;
		});

		receive(message(4, '{"id":42}', { "x-delivery-count": 2, tenant: "acme", retries: 3 }));

		await until(() => !!event);
		expect(event).toMatchObject({
			data: { id: 42 },
			topic: "orders",
			// the message id, stable across redeliveries, rather than the delivery tag
			offset: "m4",
			key: "order.created",
			exchange: "shop",
			routingKey: "order.created",
			messageId: "m4",
			deliveryTag: 4,
			redelivered: false,
			deliveryCount: 3,
			headers: { "x-delivery-count": "2", tenant: "acme", retries: "3" },
			properties: { messageId: "m4", contentType: "application/json" },
			timestamp: new Date(1_790_000_000_000).toISOString(),
		});
	});

	it("counts a redelivered classic-queue message as its second delivery", async () => {
		let attempt = 0;
		const { receive } = harness({}, async (batch) => {
			attempt = batch.attempt;
		});
		const redelivered = message(1);
		(redelivered.fields as { redelivered: boolean }).redelivered = true;

		receive(redelivered);

		await until(() => attempt > 0);
		expect(attempt).toBe(2);
	});

	it("keeps the raw channel's settling and consumer commands to itself", async () => {
		const { connection } = harness({}, async () => undefined);
		const raw = connection.raw() as any;

		for (const command of ["ack", "nack", "reject", "ackAll", "cancel", "close", "prefetch"])
			expect(() => raw[command]()).toThrow(/not available on a trigger's channel/);
		expect((await raw.checkQueue("orders")).messageCount).toBe(7);
		expect(await connection.lag()).toBe(7);
	});
});

describe("rabbitmq settings", () => {
	it("prefetches a batch per concurrent slot, within AMQP's 16-bit limit", () => {
		expect(prefetchFor({ batchSize: 10, concurrency: 4 })).toBe(40);
		expect(prefetchFor({ batchSize: 10_000, concurrency: 64 })).toBe(65_535);
	});

	it("backs requeues off from the retry delay, capped at five minutes", () => {
		expect(requeueDelayMs(1_000, 1)).toBe(1_000);
		expect(requeueDelayMs(1_000, 3)).toBe(4_000);
		expect(requeueDelayMs(1_000, 30)).toBe(300_000);
	});

	it("connects with the credentials form, leaving blanks to amqplib's defaults", () => {
		expect(
			connectionOptions({ source: "credentials", host: "mq", port: "5671", useSSL: true, database: "shop" }),
		).toEqual({
			protocol: "amqps",
			hostname: "mq",
			port: 5671,
			username: undefined,
			password: undefined,
			vhost: "shop",
		});
		expect(connectionOptions({ source: "url", url: "amqp://u:p@mq/%2F" })).toBe("amqp://u:p@mq/%2F");
	});

	it("always warns about the dead-letter exchange, and about a prefetch that cannot fill", () => {
		expect(rabbitMqWarnings({})).toHaveLength(1);
		expect(rabbitMqWarnings({ batchSize: 10_000, concurrency: 10 })).toHaveLength(2);
	});
});
