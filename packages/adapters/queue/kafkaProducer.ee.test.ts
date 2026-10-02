import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Admin, Consumer, MessagesStreamModes } from "@platformatic/kafka";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { createProducer, type KafkaConfig, testKafkaConnection } from "./kafka.ee";

/**
 * The Send Message block's Kafka producer against one real KRaft node, read
 * back with a plain consumer. Auto-creation is off, so a missing topic is a
 * failed message rather than a new topic.
 */

const IMAGE = "apache/kafka:4.1.0";
const CONTAINER = "fluxify-kafka-producer-test";
const T = 60_000;

let container: Docker.Container | undefined;
let config: KafkaConfig;
let admin: Admin;
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
				"KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093",
				`KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:${port}`,
				"KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
				"KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
				"KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
				"KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093",
				"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
				"KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
				"KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
				"KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
				"KAFKA_AUTO_CREATE_TOPICS_ENABLE=false",
			],
			HostConfig: { PortBindings: { "9092/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "9092/tcp": {} },
		}),
	);
	container = started.container;
	config = { brokers: `localhost:${started.port}` };
	const deadline = Date.now() + 90_000;
	while (!(await testKafkaConnection(config)).success) {
		if (Date.now() > deadline) throw new Error("kafka did not become ready");
		await Bun.sleep(250);
	}
	admin = new Admin({ clientId: "suite", bootstrapBrokers: [config.brokers] });
}, 180_000);

afterAll(async () => {
	await admin?.close().catch(() => {});
	if (container) await container.remove({ force: true }).catch(() => {});
});

async function topic(partitions = 1) {
	const name = `orders-${Date.now()}-${++seq}`;
	await admin.createTopics({ topics: [name], partitions, replicas: 1 });
	const deadline = Date.now() + 10_000;
	while (!(await admin.listTopics()).includes(name)) {
		if (Date.now() > deadline) throw new Error(`topic ${name} never appeared`);
		await Bun.sleep(100);
	}
	return name;
}

/** The first `count` messages on a topic, as text. */
async function read(name: string, count: number) {
	const reader = new Consumer({ clientId: "reader", groupId: `r-${name}`, bootstrapBrokers: [config.brokers] });
	const stream = await reader.consume({ topics: [name], mode: MessagesStreamModes.EARLIEST });
	const found: { key?: string; value: string; partition: number; headers: Record<string, string> }[] = [];
	await new Promise<void>((resolve) =>
		stream.on("data", (m: any) => {
			found.push({
				key: m.key?.toString(),
				value: m.value.toString(),
				partition: m.partition,
				headers: Object.fromEntries([...m.headers].map(([k, v]: [Buffer, Buffer]) => [k.toString(), v.toString()])),
			});
			if (found.length === count) resolve();
		}),
	);
	await stream.close();
	await reader.close(true);
	return found;
}

describe("sending to Kafka", () => {
	it("writes the message with its key, headers and partition, and reports its offset", async () => {
		const orders = await topic(2);
		const producer = createProducer(config);
		const outcomes = await producer.send([
			{ destination: orders, payload: { id: 7 }, key: "order-7", headers: { tenant: "acme" }, options: { partition: 1 } },
			{ destination: orders, payload: "plain", options: { partition: 1 } },
		]);
		await producer.close();

		expect(outcomes[0]).toEqual({ index: 0, ok: true, result: { topic: orders, partition: 1, offset: expect.any(String) } });
		expect(outcomes[1]).toMatchObject({ ok: true, result: { partition: 1 } });
		const offsets = outcomes.map((o) => (o.ok ? Number(o.result.offset) : -1)).sort();
		expect(offsets).toEqual([0, 1]);

		const messages = await read(orders, 2);
		const byValue = Object.fromEntries(messages.map((m) => [m.value, m]));
		expect(byValue['{"id":7}']).toMatchObject({ key: "order-7", partition: 1, headers: { tenant: "acme" } });
		expect(byValue.plain).toBeDefined();
	}, T);

	it("fails only the messages it could not write", async () => {
		const orders = await topic();
		const producer = createProducer(config);
		const outcomes = await producer.send([
			{ destination: orders, payload: 1 },
			{ destination: `missing-${Date.now()}`, payload: 2 },
			{ destination: orders, payload: 3, options: { partition: -1 } },
		]);
		await producer.close();

		expect(outcomes.map((o) => o.ok)).toEqual([true, false, false]);
		expect(outcomes[2]).toMatchObject({ error: expect.stringContaining("partition") });
		expect((await read(orders, 1))[0]!.value).toBe("1");
	}, T);
});
