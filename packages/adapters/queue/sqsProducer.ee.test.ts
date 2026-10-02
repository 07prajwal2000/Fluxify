import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	ReceiveMessageCommand,
	type SQSClient,
} from "@aws-sdk/client-sqs";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { clientFor, createProducer, type SqsConfig, testSqsConnection } from "./sqs.ee";

/**
 * The Send Message block's SQS producer against an SQS-compatible emulator
 * (floci), read back with a plain receive. Each test gets its own queue.
 */

const IMAGE = "floci/floci:latest";
const CONTAINER = "fluxify-sqs-producer-test";
const T = 60_000;

let container: Docker.Container | undefined;
let sqs: SQSClient;
let config: SqsConfig;
const queues: string[] = [];
let seq = 0;

beforeAll(async () => {
	if (process.env.SQS_TEST_ENDPOINT) {
		config = { region: "us-east-1", endpoint: process.env.SQS_TEST_ENDPOINT, accessKeyId: "test", secretAccessKey: "test" };
	} else {
		await docker.getContainer(CONTAINER).remove({ force: true }).catch(() => {});
		await pullImage(IMAGE);
		const started = await startContainerWithRandomPort((port) =>
			docker.createContainer({
				Image: IMAGE,
				name: CONTAINER,
				HostConfig: { PortBindings: { "4566/tcp": [{ HostPort: String(port) }] } },
			}),
		);
		container = started.container;
		config = { region: "us-east-1", endpoint: `http://localhost:${started.port}`, accessKeyId: "test", secretAccessKey: "test" };
	}
	sqs = clientFor(config);
	const deadline = Date.now() + 60_000;
	while (!(await testSqsConnection(config)).success) {
		if (Date.now() > deadline) throw new Error("SQS emulator did not become ready");
		await Bun.sleep(250);
	}
}, 120_000);

afterAll(async () => {
	await Promise.allSettled(queues.map((QueueUrl) => sqs.send(new DeleteQueueCommand({ QueueUrl }))));
	sqs?.destroy();
	if (container) await container.remove({ force: true }).catch(() => {});
});

async function queue(fifo = false) {
	const { QueueUrl } = await sqs.send(
		new CreateQueueCommand({
			QueueName: `orders-${Date.now()}-${++seq}${fifo ? ".fifo" : ""}`,
			Attributes: fifo ? { FifoQueue: "true" } : {},
		}),
	);
	queues.push(QueueUrl!);
	return QueueUrl!;
}

/** Everything on the queue, received until it comes back empty. */
async function drain(QueueUrl: string) {
	const all = [];
	for (;;) {
		const { Messages = [] } = await sqs.send(
			new ReceiveMessageCommand({
				QueueUrl,
				MaxNumberOfMessages: 10,
				MessageAttributeNames: ["All"],
				WaitTimeSeconds: 1,
			}),
		);
		if (Messages.length === 0) return all;
		all.push(...Messages);
	}
}

describe("sending to SQS", () => {
	it("splits a long list into batches and answers every message", async () => {
		const url = await queue();
		const producer = createProducer(config);
		const outcomes = await producer.send(
			Array.from({ length: 25 }, (_, n) => ({ destination: url, payload: { n } })),
		);
		await producer.close();

		expect(outcomes).toHaveLength(25);
		expect(outcomes.every((o) => o.ok)).toBe(true);
		expect(outcomes.map((o) => o.index)).toEqual([...Array(25).keys()]);
		const bodies = (await drain(url)).map((m) => JSON.parse(m.Body!).n).sort((a, b) => a - b);
		expect(bodies).toEqual([...Array(25).keys()]);
	}, T);

	it("sends text as-is, headers as message attributes", async () => {
		const url = await queue();
		const producer = createProducer(config);
		const [outcome] = await producer.send([
			{ destination: url, payload: "plain", headers: { tenant: "acme" } },
		]);
		await producer.close();

		expect(outcome).toMatchObject({ ok: true, result: { queueUrl: url, messageId: expect.any(String) } });
		const [message] = await drain(url);
		expect(message!.Body).toBe("plain");
		expect(message!.MessageAttributes?.tenant?.StringValue).toBe("acme");
	}, T);

	it("sets the group and deduplication IDs a FIFO queue needs", async () => {
		const url = await queue(true);
		const producer = createProducer(config);
		const outcomes = await producer.send([
			{ destination: url, payload: { n: 1 }, options: { groupId: "g", deduplicationId: "d1" } },
			// FIFO refuses a message without a group: that one fails alone
			{ destination: url, payload: { n: 2 } },
		]);
		await producer.close();

		expect(outcomes[0]).toMatchObject({ ok: true, result: { sequenceNumber: expect.any(String) } });
		expect(outcomes[1]).toMatchObject({ index: 1, ok: false, error: expect.any(String) });
	}, T);

	it("fails every message of a batch sent to a queue that does not exist", async () => {
		const producer = createProducer(config);
		const missing = `${config.endpoint}/000000000000/missing-${Date.now()}`;
		const outcomes = await producer.send([
			{ destination: missing, payload: 1 },
			{ destination: missing, payload: 2 },
		]);
		await producer.close();

		expect(outcomes.map((o) => o.ok)).toEqual([false, false]);
		expect(outcomes[0]).toMatchObject({ error: expect.stringContaining("does not exist") });
	}, T);
});
