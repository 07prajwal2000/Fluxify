import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type Docker from "dockerode";
import { Admin, Consumer, MessagesStreamModes, Producer } from "@platformatic/kafka";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import type { QueueBatch, QueueConnection, QueueHandler, QueueSubscription } from "./base";
import { createConnection, ensureKafkaTopics, testKafkaConnection, type KafkaConfig } from "./kafka";
import { QueueConnectionManager } from "./manager";

/**
 * The Kafka connector against a real broker: one KRaft node with a plain
 * listener and a SASL/PLAIN one. Each test gets its own topics and group, so
 * nothing one test commits is seen by another.
 */

// The JVM image, not kafka-native: the GraalVM build cannot run SASL
// ("Unable to find suitable Subject#doAs") and drops every SASL connection.
const IMAGE = "apache/kafka:latest";
const CONTAINER = "fluxify-kafka-test-suite";
const SASL_USER = "fluxify";
const SASL_PASSWORD = "s3cret";
const T = 60_000;

let container: Docker.Container | undefined;
let config: KafkaConfig;
let saslPort: number;
let admin: Admin;
let producer: Producer;
const open: QueueConnection[] = [];
let seq = 0;

beforeAll(async () => {
	await docker.getContainer(CONTAINER).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			Env: [
				"KAFKA_NODE_ID=1",
				"KAFKA_PROCESS_ROLES=broker,controller",
				"KAFKA_LISTENERS=PLAINTEXT://:9092,SASL://:9094,CONTROLLER://:9093",
				`KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:${port},SASL://localhost:${port + 1}`,
				"KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,SASL:SASL_PLAINTEXT",
				"KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
				"KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
				"KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093",
				"KAFKA_SASL_ENABLED_MECHANISMS=PLAIN",
				`KAFKA_LISTENER_NAME_SASL_PLAIN_SASL_JAAS_CONFIG=org.apache.kafka.common.security.plain.PlainLoginModule required username="${SASL_USER}" password="${SASL_PASSWORD}" user_${SASL_USER}="${SASL_PASSWORD}";`,
				"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
				"KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
				"KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
				"KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
			],
			HostConfig: {
				PortBindings: {
					"9092/tcp": [{ HostPort: String(port) }],
					"9094/tcp": [{ HostPort: String(port + 1) }],
				},
			},
			ExposedPorts: { "9092/tcp": {}, "9094/tcp": {} },
		}),
	);
	container = started.container;
	saslPort = started.port + 1;
	config = { brokers: `localhost:${started.port}`, dlqTopic: "fluxify.dlq" };

	await until(async () => (await testKafkaConnection(config)).success, 90_000);
	admin = new Admin({ clientId: "suite", bootstrapBrokers: [config.brokers] });
	// idempotent: a produce retried while a fresh topic elects its leader would
	// otherwise be written twice, and every count below would be off
	producer = new Producer({ clientId: "suite", bootstrapBrokers: [config.brokers], idempotent: true });
	await admin.createTopics({ topics: ["fluxify.dlq"], partitions: 1, replicas: 1 });
}, 180_000);

afterEach(async () => {
	await Promise.allSettled(open.splice(0).map((connection) => connection.stop()));
});

afterAll(async () => {
	await producer?.close().catch(() => {});
	await admin?.close().catch(() => {});
	if (container) await container.remove({ force: true }).catch(() => {});
});

/* ----------------------------------------------------------------- helpers */

async function until(done: () => boolean | Promise<boolean>, ms = 30_000) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(100);
	}
}

async function topic(partitions = 1) {
	const name = `orders-${Date.now()}-${++seq}`;
	await admin.createTopics({ topics: [name], partitions, replicas: 1 });
	return name;
}

type Outgoing = {
	value: unknown;
	partition?: number;
	key?: string;
	headers?: Record<string, string>;
};

async function send(to: string, messages: Outgoing[]) {
	await producer.send({
		messages: messages.map((m) => ({
			topic: to,
			partition: m.partition ?? 0,
			key: m.key === undefined ? undefined : Buffer.from(m.key),
			value:
				m.value === null
					? undefined
					: Buffer.from(typeof m.value === "string" ? m.value : JSON.stringify(m.value)),
			headers: new Map(
				Object.entries(m.headers ?? {}).map(([k, v]) => [Buffer.from(k), Buffer.from(v)]),
			),
		})),
	});
}

const numbered = (from: number, count: number, partition = 0): Outgoing[] =>
	Array.from({ length: count }, (_, i) => ({ value: { n: from + i }, partition }));

function subscription(topics: string[], settings: Partial<QueueSubscription> = {}) {
	return {
		source: { topics, fromBeginning: true },
		consumerGroup: `fluxify-${topics[0]}`,
		batchSize: 10,
		maxWaitMs: 200,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		...settings,
	} satisfies QueueSubscription;
}

async function start(sub: QueueSubscription, handler: QueueHandler, settings: Partial<KafkaConfig> = {}) {
	const connection = createConnection({ ...config, ...settings });
	open.push(connection);
	await connection.consume(sub, handler);
	return connection;
}

/** Commits every batch and records what came in. */
function recorder() {
	const batches: QueueBatch[] = [];
	const handler: QueueHandler = async (batch, connection) => {
		batches.push(batch);
		await connection.commit(batch);
	};
	const values = () => batches.flatMap((b) => b.events.map((e) => (e.data as any)?.n));
	return { batches, handler, values };
}

/* ------------------------------------------------------------------- tests */

describe("testing a Kafka integration", () => {
	it("succeeds against a live broker", async () => {
		expect(await testKafkaConnection(config)).toEqual({ success: true, error: "" });
	});

	it("fails when nothing is listening", async () => {
		const result = await testKafkaConnection({ brokers: "localhost:1" });
		expect(result.success).toBe(false);
		expect(result.error).not.toBe("");
	}, T);

	it("reads a comma-separated broker list, skipping blanks", async () => {
		const result = await testKafkaConnection({ brokers: ` ${config.brokers} , ,` });
		expect(result.success).toBe(true);
	});

	it("authenticates with SASL/PLAIN", async () => {
		const result = await testKafkaConnection({
			brokers: `localhost:${saslPort}`,
			saslMechanism: "PLAIN",
			username: SASL_USER,
			password: SASL_PASSWORD,
		});
		expect(result).toEqual({ success: true, error: "" });
	}, T);

	it("is refused with the wrong SASL password", async () => {
		const result = await testKafkaConnection({
			brokers: `localhost:${saslPort}`,
			saslMechanism: "PLAIN",
			username: SASL_USER,
			password: "wrong",
		});
		expect(result.success).toBe(false);
	}, T);

	it("is refused by a SASL listener when no mechanism is set", async () => {
		const result = await testKafkaConnection({ brokers: `localhost:${saslPort}` });
		expect(result.success).toBe(false);
	}, T);
});

describe("checking a trigger's topics", () => {
	const fresh = () => `created-${Date.now()}-${++seq}`;

	it("passes when every topic exists", async () => {
		const orders = await topic();
		expect(await ensureKafkaTopics(config, [orders, orders], false)).toEqual([]);
	}, T);

	it("names the missing topics and creates nothing when creating is off", async () => {
		const orders = await topic();
		const [a, b] = [fresh(), fresh()];
		await expect(ensureKafkaTopics(config, [orders, a, b], false)).rejects.toThrow(
			`Topics not found: ${a}, ${b}`,
		);
		expect(await admin.listTopics()).not.toContain(a);
	}, T);

	it("creates only the missing topics, which can then be consumed", async () => {
		const orders = await topic();
		const created = fresh();
		expect(await ensureKafkaTopics(config, [orders, created], true)).toEqual([created]);
		expect(await admin.listTopics()).toContain(created);

		const { handler, values } = recorder();
		await start(subscription([created]), handler);
		await send(created, numbered(0, 1));
		await until(() => values().length === 1);
	}, T);

	it("says the brokers could not be reached", async () => {
		await expect(ensureKafkaTopics({ brokers: "localhost:1" }, ["x"], true)).rejects.toThrow(
			/Could not reach the Kafka brokers/,
		);
	}, T);
});

describe("consuming a topic", () => {
	it("hands over events with where they came from, decoding JSON, text and tombstones", async () => {
		const orders = await topic();
		await send(orders, [
			{ value: { n: 1 }, key: "order-1", headers: { tenant: "acme" } },
			{ value: "plain text" },
			{ value: null, key: "order-1" },
		]);
		const { batches, handler } = recorder();
		await start(subscription([orders], { batchSize: 3 }), handler);

		await until(() => batches.length > 0 && batches.flatMap((b) => b.events).length === 3);
		const events = batches.flatMap((b) => b.events);
		expect(events.map((e) => e.data)).toEqual([{ n: 1 }, "plain text", null]);
		expect(events[0]).toMatchObject({
			topic: orders,
			partition: 0,
			offset: "0",
			key: "order-1",
			headers: { tenant: "acme" },
		});
		expect(events[1]!.key).toBeNull();
		expect(Number.isNaN(Date.parse(events[0]!.timestamp))).toBe(false);
		expect(batches[0]!).toMatchObject({ consumerGroup: `fluxify-${orders}`, attempt: 1 });
	}, T);

	it("splits a backlog into batches of at most batchSize", async () => {
		const orders = await topic();
		await send(orders, numbered(0, 7));
		const { batches, handler, values } = recorder();
		await start(subscription([orders], { batchSize: 3 }), handler);

		await until(() => values().length === 7);
		expect(values()).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(batches.every((b) => b.events.length <= 3)).toBe(true);
	}, T);

	it("sends a part-filled batch once maxWaitMs passes", async () => {
		const orders = await topic();
		await send(orders, numbered(0, 2));
		const { batches, handler } = recorder();
		await start(subscription([orders], { batchSize: 100, maxWaitMs: 300 }), handler);

		await until(() => batches.length === 1);
		expect(batches[0]!.events).toHaveLength(2);
	}, T);

	it("ends a batch before it goes over maxBytes, but never sends an empty one", async () => {
		const orders = await topic();
		const big = "x".repeat(700);
		await send(orders, [{ value: big }, { value: big }, { value: big }]);
		const { batches, handler } = recorder();
		await start(subscription([orders], { batchSize: 10, maxBytes: 1024 }), handler);

		await until(() => batches.flatMap((b) => b.events).length === 3);
		expect(batches.map((b) => b.events.length)).toEqual([1, 1, 1]);
	}, T);

	it("reads every topic it is given", async () => {
		const [a, b] = [await topic(), await topic()];
		await send(a, [{ value: { n: 1 } }]);
		await send(b, [{ value: { n: 2 } }]);
		const { batches, handler, values } = recorder();
		await start(subscription([a, b]), handler);

		await until(() => values().length === 2);
		expect(values().sort()).toEqual([1, 2]);
		expect(new Set(batches.map((x) => x.events[0]!.topic))).toEqual(new Set([a, b]));
	}, T);

	it("starts at the newest event when the trigger is new and not reading from the beginning", async () => {
		const orders = await topic();
		await send(orders, numbered(0, 3));
		const { handler, values } = recorder();
		await start({ ...subscription([orders]), source: { topics: [orders] } }, handler);

		// joined and positioned at the end before anything new arrives
		await Bun.sleep(3_000);
		await send(orders, numbered(100, 2));
		await until(() => values().length === 2);
		await Bun.sleep(500);
		expect(values()).toEqual([100, 101]);
	}, T);

	it("refuses a subscription with no topic", async () => {
		const connection = createConnection(config);
		await expect(
			connection.consume({ ...subscription([]), source: { topics: [] } }, async () => {}),
		).rejects.toThrow(/at least one topic/);
	});
});

describe("ordering and concurrency", () => {
	it("runs partitions side by side but each partition strictly in order", async () => {
		const orders = await topic(2);
		await send(orders, [...numbered(0, 5, 0), ...numbered(0, 5, 1)]);
		const seen: Record<number, number[]> = { 0: [], 1: [] };
		let running = 0;
		let peak = 0;
		await start(subscription([orders], { batchSize: 1, concurrency: 2 }), async (batch, connection) => {
			peak = Math.max(peak, ++running);
			await Bun.sleep(50);
			const event = batch.events[0]!;
			seen[event.partition]!.push((event.data as any).n);
			running--;
			await connection.commit(batch);
		});

		await until(() => seen[0]!.length >= 5 && seen[1]!.length >= 5);
		await Bun.sleep(300);
		expect(seen[0]).toEqual([0, 1, 2, 3, 4]);
		expect(seen[1]).toEqual([0, 1, 2, 3, 4]);
		expect(peak).toBe(2);
	}, T);

	it("never runs more batches at once than its concurrency", async () => {
		const orders = await topic(2);
		await send(orders, [...numbered(0, 3, 0), ...numbered(0, 3, 1)]);
		let running = 0;
		let peak = 0;
		let done = 0;
		await start(subscription([orders], { batchSize: 1, concurrency: 1 }), async (batch, connection) => {
			peak = Math.max(peak, ++running);
			await Bun.sleep(30);
			running--;
			done++;
			await connection.commit(batch);
		});

		await until(() => done >= 6);
		await Bun.sleep(300);
		expect(done).toBe(6);
		expect(peak).toBe(1);
	}, T);
});

describe("delivery guarantees", () => {
	it("delivers a batch again, unchanged, when the handler throws", async () => {
		const orders = await topic();
		await send(orders, numbered(0, 2));
		const attempts: string[] = [];
		await start(subscription([orders], { batchSize: 2 }), async (batch, connection) => {
			attempts.push(batch.events.map((e) => e.offset).join(","));
			if (attempts.length < 3) throw new Error("downstream is down");
			await connection.commit(batch);
		});

		await until(() => attempts.length === 3, 20_000);
		expect(attempts).toEqual(["0,1", "0,1", "0,1"]);
	}, T);

	it("holds a failing partition back without holding up the others", async () => {
		const orders = await topic(2);
		await send(orders, [...numbered(0, 2, 0), ...numbered(0, 2, 1)]);
		const done: string[] = [];
		await start(subscription([orders], { batchSize: 1, concurrency: 2 }), async (batch, connection) => {
			const event = batch.events[0]!;
			if (event.partition === 0) throw new Error("poison");
			done.push(`${event.partition}:${(event.data as any).n}`);
			await connection.commit(batch);
		});

		await until(() => done.length >= 2);
		await Bun.sleep(500);
		expect(done).toEqual(["1:0", "1:1"]);
	}, T);

	it("resumes after a restart from the last commit, not from the beginning", async () => {
		const orders = await topic();
		const sub = subscription([orders], { batchSize: 5 });
		await send(orders, numbered(0, 3));
		const first = recorder();
		const connection = await start(sub, first.handler);
		await until(() => first.values().length === 3);
		await connection.stop();

		await send(orders, numbered(3, 2));
		const second = recorder();
		await start(sub, second.handler);
		await until(() => second.values().length === 2);
		await Bun.sleep(500);
		expect(second.values()).toEqual([3, 4]);
	}, T);

	it("runs an uncommitted batch again after its worker dies mid-batch", async () => {
		const orders = await topic();
		const sub = subscription([orders], { batchSize: 2 });
		await send(orders, numbered(0, 4));
		const crashed = createConnection(config);
		const firstRun: number[][] = [];
		await crashed.consume(sub, async (batch, connection) => {
			const values = batch.events.map((e) => (e.data as any).n);
			firstRun.push(values);
			if (values.includes(2)) return new Promise<void>(() => {}); // stuck forever
			await connection.commit(batch);
		});
		await until(() => firstRun.flat().includes(2));
		// the process is gone: its consumer leaves the group, the stuck batch is never committed
		await Promise.resolve((crashed.raw() as Consumer).close(true)).catch(() => {});

		const second = recorder();
		await start(sub, second.handler);
		await until(() => second.values().length === 2);
		expect(firstRun[0]).toEqual([0, 1]);
		expect(second.values()).toEqual([2, 3]);
	}, T);

	it("does nothing to offsets unless told to, so a manual trigger's uncommitted work comes back", async () => {
		const orders = await topic();
		const sub = subscription([orders], { batchSize: 5 });
		await send(orders, numbered(0, 2));
		const seen: number[] = [];
		const connection = await start(sub, async (batch) => {
			seen.push(...batch.events.map((e) => (e.data as any).n));
		});
		await until(() => seen.length === 2);
		await connection.stop();

		const again = recorder();
		await start(sub, again.handler);
		await until(() => again.values().length === 2);
		expect(again.values()).toEqual([0, 1]);
	}, T);
});

describe("lag", () => {
	it("counts what is read but not yet committed, and drops to zero once it is", async () => {
		const orders = await topic();
		await send(orders, numbered(0, 4));
		const held: QueueBatch[] = [];
		const connection = await start(subscription([orders], { batchSize: 2 }), async (batch, conn) => {
			if (held.length === 0) await conn.commit(batch);
			held.push(batch);
		});

		await until(() => held.length === 2);
		await until(async () => (await connection.lag()) === 2);
		await connection.commit(held[1]!);
		await until(async () => (await connection.lag()) === 0);
	}, T);

	it("is unknown before the connection is consuming", async () => {
		expect(await createConnection(config).lag()).toBeNull();
	});
});

describe("dead-lettering", () => {
	it("parks a batch on the dead-letter topic with the original message and where it came from", async () => {
		const orders = await topic();
		await send(orders, [{ value: { n: 9 }, key: "order-9", headers: { tenant: "acme" } }]);
		let parked: QueueBatch | undefined;
		await start(subscription([orders]), async (batch, connection) => {
			await connection.moveToDLQ(batch, new Error("card declined"));
			await connection.commit(batch);
			parked = batch;
		});
		await until(() => !!parked);

		const reader = new Consumer({
			clientId: "dlq-reader",
			groupId: `dlq-${orders}`,
			bootstrapBrokers: [config.brokers],
		});
		const stream = await reader.consume({ topics: ["fluxify.dlq"], mode: MessagesStreamModes.EARLIEST });
		const found = await new Promise<any>((resolve) =>
			stream.on("data", (m: any) => {
				if (m.headers.get?.(Buffer.from("x-fluxify-topic")) === undefined) {
					const headers = Object.fromEntries(
						[...m.headers].map(([k, v]: [Buffer, Buffer]) => [k.toString(), v.toString()]),
					);
					if (headers["x-fluxify-topic"] === orders) resolve({ m, headers });
				}
			}),
		);
		await stream.close();
		await reader.close(true);

		expect(JSON.parse(found.m.value.toString())).toEqual({ n: 9 });
		expect(found.m.key.toString()).toBe("order-9");
		expect(found.headers).toMatchObject({
			tenant: "acme",
			"x-fluxify-error": "Error: card declined",
			"x-fluxify-topic": orders,
			"x-fluxify-partition": "0",
			"x-fluxify-offset": "0",
			"x-fluxify-consumer-group": `fluxify-${orders}`,
		});
	}, T);

	it("refuses to dead-letter when the integration has no dead-letter topic", async () => {
		const orders = await topic();
		await send(orders, numbered(0, 1));
		let failure: unknown;
		await start(
			subscription([orders]),
			async (batch, connection) => {
				failure ??= await connection.moveToDLQ(batch, "x").catch((e) => e);
				await connection.commit(batch);
			},
			{ dlqTopic: undefined },
		);
		await until(() => !!failure);
		expect(String(failure)).toMatch(/dead-letter topic/);
	}, T);
});

describe("lifecycle", () => {
	it("exposes the underlying client", async () => {
		const orders = await topic();
		const connection = await start(subscription([orders]), async () => {});
		expect(connection.raw()).toBeInstanceOf(Consumer);
	}, T);

	it("leaves the group on stop, so the next consumer takes over straight away", async () => {
		const orders = await topic();
		const sub = subscription([orders]);
		const first = await start(sub, async (b, c) => c.commit(b));
		await Bun.sleep(2_000);
		const stopped = Date.now();
		await first.stop();

		await send(orders, numbered(0, 1));
		const next = recorder();
		await start(sub, next.handler);
		await until(() => next.values().length === 1);
		// well inside the one-minute session timeout a dead member would cost
		expect(Date.now() - stopped).toBeLessThan(20_000);
	}, T);

	it("is started, restarted on a changed spec and stopped by the manager", async () => {
		const orders = await topic();
		const manager = new QueueConnectionManager(async () => ({ createConnection }));
		const { handler, values } = recorder();
		const spec = { type: "kafka", config, subscription: subscription([orders], { batchSize: 1 }) };

		await manager.start("t1", spec, handler);
		const firstConnection = manager.connection("t1");
		await manager.start("t1", spec, handler);
		expect(manager.connection("t1")).toBe(firstConnection);

		await send(orders, numbered(0, 1));
		await until(() => values().length === 1);

		await manager.start("t1", { ...spec, subscription: { ...spec.subscription, batchSize: 5 } }, handler);
		expect(manager.connection("t1")).not.toBe(firstConnection);
		await send(orders, numbered(1, 1));
		await until(() => values().length === 2);
		expect(values()).toEqual([0, 1]);

		await manager.close();
		expect(manager.has("t1")).toBe(false);
		expect(manager.getStats()).toEqual({ running: 0, connectors: [] });
	}, T);
});
