import { expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { ensureKafkaTopics, testKafkaConnection } from "./kafka.ee";

/**
 * A broker that advertises a name only its own network resolves: the address
 * typed in answers, every read after it goes nowhere. The error must say so.
 */

const IMAGE = "apache/kafka:4.1.0";

async function until(done: () => Promise<boolean>, ms: number) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(500);
	}
}

it("names the advertised address when the broker hands out one this server cannot reach", async () => {
	await pullImage(IMAGE);
	const name = "fluxify-kafka-test-advertised";
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
	const { container: broker, port } = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name,
			Env: [
				"KAFKA_NODE_ID=1",
				"KAFKA_PROCESS_ROLES=broker,controller",
				"KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093",
				// the usual Docker mistake: a name only the container network resolves
				"KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka-internal:9092",
				"KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
				"KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093",
				"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
			],
			HostConfig: { PortBindings: { "9092/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "9092/tcp": {} },
		}),
	);
	try {
		const brokers = `localhost:${port}`;
		let result = { success: true, error: "" };
		// until the broker is up the error is a plain connect failure
		await until(async () => (result = await testKafkaConnection({ brokers })).error.includes("kafka-internal"), 90_000);
		expect(result.success).toBe(false);
		expect(result.error).toContain(`Connected to ${brokers}`);
		expect(result.error).toContain("KAFKA_ADVERTISED_LISTENERS");
		await expect(ensureKafkaTopics({ brokers }, ["orders"], true)).rejects.toThrow("kafka-internal:9092");
	} finally {
		await broker.remove({ force: true }).catch(() => {});
	}
}, 150_000);
