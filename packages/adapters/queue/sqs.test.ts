import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	GetQueueAttributesCommand,
	ReceiveMessageCommand,
	SendMessageCommand,
	type SQSClient,
} from "@aws-sdk/client-sqs";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { QueueSourceGoneError, type QueueBatch, type QueueConnection, type QueueHandler, type QueueSubscription } from "./base";
import {
	assertSqsQueue,
	clientFor,
	createConnection,
	describeSqsError,
	retryDelaySec,
	sqsWarnings,
	testSqsConnection,
	type SqsConfig,
	type SqsSource,
} from "./sqs";
import { QueueConnectionManager } from "./manager";

/**
 * The SQS connector against an SQS-compatible emulator (floci): a fresh
 * container per run, unless SQS_TEST_ENDPOINT points at one already running.
 * Each test gets its own queue.
 */

const IMAGE = "floci/floci:latest";
const CONTAINER = "fluxify-sqs-test";
const T = 60_000;

let container: Docker.Container | undefined;
let sqs: SQSClient;
let config: SqsConfig;
const open: QueueConnection[] = [];
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
	await until(async () => (await testSqsConnection(config)).success, 60_000);
}, 120_000);

afterEach(async () => {
	await Promise.allSettled(open.splice(0).map((connection) => connection.stop()));
});

afterAll(async () => {
	await Promise.allSettled(queues.map((QueueUrl) => sqs.send(new DeleteQueueCommand({ QueueUrl }))));
	sqs?.destroy();
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

async function queue(attributes: Record<string, string> = {}) {
	const { QueueUrl } = await sqs.send(
		new CreateQueueCommand({ QueueName: `orders-${Date.now()}-${++seq}`, Attributes: attributes }),
	);
	queues.push(QueueUrl!);
	return QueueUrl!;
}

type Outgoing = { value: unknown; headers?: Record<string, string> };

async function send(to: string, messages: Outgoing[]) {
	for (const m of messages)
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: to,
				MessageBody: typeof m.value === "string" ? m.value : JSON.stringify(m.value),
				MessageAttributes: Object.fromEntries(
					Object.entries(m.headers ?? {}).map(([k, v]) => [k, { DataType: "String", StringValue: v }]),
				),
			}),
		);
}

const numbered = (from: number, count: number): Outgoing[] =>
	Array.from({ length: count }, (_, i) => ({ value: { n: from + i } }));

function subscription(queueUrl: string, settings: Partial<QueueSubscription> = {}, source: Partial<SqsSource> = {}) {
	return {
		source: { queueUrl, waitTimeSeconds: 1, visibilityTimeoutSec: 30, ...source },
		consumerGroup: "fluxify-t1",
		batchSize: 10,
		maxWaitMs: 0,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		retryDelayMs: 0,
		...settings,
	} satisfies QueueSubscription;
}

async function start(sub: QueueSubscription, handler: QueueHandler) {
	const connection = createConnection(config);
	open.push(connection);
	await connection.consume(sub, handler);
	return connection;
}

function recorder() {
	const batches: QueueBatch[] = [];
	const handler: QueueHandler = async (batch, connection) => {
		batches.push(batch);
		await connection.commit(batch);
	};
	const values = () => batches.flatMap((b) => b.events.map((e) => (e.data as any)?.n)).sort((a, b) => a - b);
	return { batches, handler, values };
}

async function visible(queueUrl: string) {
	const { Attributes } = await sqs.send(
		new GetQueueAttributesCommand({
			QueueUrl: queueUrl,
			AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
		}),
	);
	return Number(Attributes!.ApproximateNumberOfMessages) + Number(Attributes!.ApproximateNumberOfMessagesNotVisible);
}

/* ------------------------------------------------------------------- tests */

describe("testing an SQS integration", () => {
	it("succeeds against a live endpoint", async () => {
		expect(await testSqsConnection(config)).toEqual({ success: true, error: "" });
	});

	it("fails when nothing is listening", async () => {
		const result = await testSqsConnection({ ...config, endpoint: "http://localhost:1" });
		expect(result.success).toBe(false);
		expect(result.error).not.toBe("");
	}, T);
});

describe("checking a trigger's queue", () => {
	it("passes when the queue exists, with no redrive policy", async () => {
		expect(await assertSqsQueue(config, await queue())).toMatchObject({ redrivePolicy: null });
	});

	it("returns the redrive policy when one is set", async () => {
		const dlq = await queue();
		const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ["QueueArn"] }));
		const url = await queue({
			RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Attributes!.QueueArn, maxReceiveCount: 3 }),
		});
		const { redrivePolicy } = await assertSqsQueue(config, url);
		expect(Number(redrivePolicy!.maxReceiveCount)).toBe(3);
	});

	it("names a missing queue", async () => {
		await expect(assertSqsQueue(config, `${config.endpoint}/000000000000/missing-${++seq}`)).rejects.toThrow(
			/Queue "missing-\d+" does not exist/,
		);
	});
});

describe("warning about an SQS trigger", () => {
	const dlq = { deadLetterTargetArn: "arn:aws:sqs:us-east-1:000000000000:orders-dlq", maxReceiveCount: 4 };

	it("says a queue without a dead-letter queue keeps failing messages until retention", () => {
		expect(sqsWarnings({}, { redrivePolicy: null, visibilityTimeoutSec: 30 })).toEqual([
			expect.stringContaining("no dead-letter queue"),
		]);
	});

	it("says retries follow the redrive policy, naming the dead-letter queue", () => {
		const [warning] = sqsWarnings({}, { redrivePolicy: dlq, visibilityTimeoutSec: 30 });
		expect(warning).toContain("after 4 receives");
		expect(warning).toContain('"orders-dlq"');
	});

	it("flags a batch over 10 and a short poll, without asking AWS", () => {
		expect(sqsWarnings({ batchSize: 25, waitTimeSeconds: 0 })).toEqual([
			expect.stringContaining("above the SQS limit"),
			expect.stringContaining("long polling off"),
		]);
		expect(sqsWarnings({ batchSize: 10, waitTimeSeconds: 20 })).toEqual([]);
	});

	it("puts SDK errors in words a user can act on", () => {
		expect(describeSqsError({ name: "InvalidClientTokenId" })).toContain("access key ID");
		expect(describeSqsError({ name: "SignatureDoesNotMatch" })).toContain("secret access key");
		expect(describeSqsError({ name: "AccessDenied" }, "https://sqs/1/orders")).toContain('"orders"');
		expect(describeSqsError({ name: "", message: "", code: "ECONNREFUSED" })).toContain("Could not reach SQS");
	});
});

describe("consuming a queue", () => {
	it("hands over events with where they came from, decoding JSON and text", async () => {
		const url = await queue();
		await send(url, [{ value: { n: 1 }, headers: { tenant: "acme" } }]);
		await send(url, [{ value: "plain text" }]);
		const { batches, handler } = recorder();
		await start(subscription(url), handler);

		await until(() => batches.flatMap((b) => b.events).length === 2);
		const events = batches.flatMap((b) => b.events);
		expect(events.map((e) => e.data)).toContainEqual({ n: 1 });
		expect(events.map((e) => e.data)).toContain("plain text");
		const first = events.find((e) => (e.data as any)?.n === 1)!;
		expect(first).toMatchObject({ topic: url.split("/").pop(), partition: 0, key: null });
		expect(first.offset).toBeString();
		expect(first.headers).toEqual({ tenant: "acme" });
		expect(Number.isNaN(Date.parse(first.timestamp))).toBe(false);
		expect(batches[0]!).toMatchObject({ consumerGroup: "fluxify-t1", attempt: 1 });
	}, T);

	it("splits a backlog into batches of at most batchSize, and deletes what it commits", async () => {
		const url = await queue();
		await send(url, numbered(0, 7));
		const { batches, handler, values } = recorder();
		await start(subscription(url, { batchSize: 3 }), handler);

		await until(() => values().length === 7);
		expect(values()).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(batches.every((b) => b.events.length <= 3)).toBe(true);
		await until(async () => (await visible(url)) === 0);
	}, T);

	it("ends a batch before it goes over maxBytes, but never sends an empty one", async () => {
		const url = await queue();
		const big = "x".repeat(700);
		await send(url, [{ value: big }, { value: big }, { value: big }]);
		const { batches, handler } = recorder();
		await start(subscription(url, { maxBytes: 1024 }), handler);

		await until(() => batches.flatMap((b) => b.events).length === 3);
		expect(batches.every((b) => b.events.length === 1)).toBe(true);
	}, T);

	it("refuses a subscription with no queue URL", async () => {
		await expect(createConnection(config).consume({ ...subscription("x"), source: {} }, async () => {})).rejects.toThrow(
			/needs a queue URL/,
		);
	});

	it("fails to start on a queue that does not exist", async () => {
		const connection = createConnection(config);
		open.push(connection);
		await expect(
			connection.consume(subscription(`${config.endpoint}/000000000000/missing-${++seq}`), async () => {}),
		).rejects.toBeInstanceOf(QueueSourceGoneError);
	}, T);

	it("stops and says so, once, when the queue is deleted under it", async () => {
		const url = await queue();
		const gone: QueueSourceGoneError[] = [];
		await start(subscription(url, { concurrency: 2, onSourceGone: (error) => gone.push(error) }), async () => {});
		await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));

		await until(() => gone.length > 0);
		await Bun.sleep(1_500); // the second worker must not report it again
		expect(gone).toHaveLength(1);
		expect(gone[0]!.message).toContain("does not exist");
	}, T);
});

describe("concurrency", () => {
	it("runs up to concurrency batches side by side, never more", async () => {
		const url = await queue();
		await send(url, numbered(0, 6));
		let running = 0;
		let peak = 0;
		let done = 0;
		await start(subscription(url, { batchSize: 1, concurrency: 2 }), async (batch, connection) => {
			peak = Math.max(peak, ++running);
			await Bun.sleep(200);
			running--;
			done++;
			await connection.commit(batch);
		});

		await until(() => done >= 6);
		expect(peak).toBe(2);
	}, T);
});

describe("delivery guarantees", () => {
	it("delivers a message again, counting receives, when the handler throws", async () => {
		const url = await queue();
		await send(url, numbered(0, 1));
		const attempts: number[] = [];
		await start(subscription(url), async (batch, connection) => {
			attempts.push(batch.attempt);
			if (attempts.length < 3) throw new Error("downstream is down");
			await connection.commit(batch);
		});

		await until(() => attempts.length === 3, 20_000);
		expect(attempts).toEqual([1, 2, 3]);
		await until(async () => (await visible(url)) === 0);
	}, T);

	it("returns an uncommitted batch straight away, not after the visibility timeout", async () => {
		const url = await queue();
		await send(url, numbered(0, 1));
		let runs = 0;
		// a 60s visibility timeout: seeing it twice inside the test means it was released
		await start(subscription(url, {}, { visibilityTimeoutSec: 60 }), async (batch, connection) => {
			if (++runs === 2) await connection.commit(batch);
		});
		await until(() => runs === 2, 15_000);
	}, T);

	it("hands unfinished messages back on stop, so a restart gets them at once", async () => {
		const url = await queue();
		await send(url, numbered(0, 2));
		const sub = subscription(url, {}, { visibilityTimeoutSec: 60 });
		let seen = 0;
		const connection = await start(sub, async () => {
			seen++;
			await Bun.sleep(1_000);
			throw new Error("interrupted");
		});
		await until(() => seen > 0);
		await connection.stop();

		const again = recorder();
		await start(sub, again.handler);
		await until(() => again.values().length === 2, 15_000);
	}, T);

	it("keeps a slow batch to itself past the visibility timeout while the handler runs", async () => {
		const url = await queue();
		await send(url, numbered(0, 1));
		let runs = 0;
		await start(subscription(url, { concurrency: 2 }, { visibilityTimeoutSec: 2 }), async (batch, connection) => {
			runs++;
			await Bun.sleep(5_000); // more than twice the visibility timeout
			await connection.commit(batch);
		});
		await until(() => runs === 1);
		await Bun.sleep(6_000);
		expect(runs).toBe(1);
	}, T);

	it("leaves dead-lettering to the queue's redrive policy", async () => {
		const dlq = await queue();
		const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ["QueueArn"] }));
		const url = await queue({
			RedrivePolicy: JSON.stringify({ deadLetterTargetArn: Attributes!.QueueArn, maxReceiveCount: 2 }),
		});
		await send(url, [{ value: { n: 9 } }]);
		let runs = 0;
		await start(subscription(url), async () => {
			runs++;
			throw new Error("card declined");
		});

		const parked = await until(async () => {
			const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({ QueueUrl: dlq, WaitTimeSeconds: 1 }));
			return Messages.some((m) => JSON.parse(m.Body!).n === 9);
		}, 30_000).then(() => true);
		expect(parked).toBe(true);
		expect(runs).toBe(2);
	}, T);

	it("refuses to dead-letter by hand", async () => {
		await expect(createConnection(config).moveToDLQ({} as QueueBatch, "x")).rejects.toThrow(/redrive policy/);
	});
});

describe("lag", () => {
	it("counts waiting and in-flight messages, and drops to zero once committed", async () => {
		const url = await queue();
		await send(url, numbered(0, 3));
		const held: QueueBatch[] = [];
		const finish = Promise.withResolvers<void>();
		const connection = await start(subscription(url, { batchSize: 10 }), async (batch) => {
			held.push(batch);
			await finish.promise; // stays in flight
		});
		await until(() => held.flatMap((b) => b.events).length === 3);
		expect(await connection.lag()).toBe(3);
		for (const batch of held) await connection.commit(batch);
		await until(async () => (await connection.lag()) === 0);
		finish.resolve();
	}, T);

	it("is unknown before the connection is consuming", async () => {
		expect(await createConnection(config).lag()).toBeNull();
	});
});

describe("retry delay", () => {
	it("doubles per receive from the trigger's delay, in whole seconds, capped at 12h", () => {
		expect([1, 2, 3, 4].map((n) => retryDelaySec(1_000, n))).toEqual([1, 2, 4, 8]);
		expect(retryDelaySec(0, 5)).toBe(0);
		expect(retryDelaySec(60_000, 20)).toBe(43_200);
	});
});

describe("lifecycle", () => {
	it("exposes the SQS client and says it dead-letters natively", async () => {
		const url = await queue();
		const connection = await start(subscription(url), async () => {});
		expect(typeof (connection.raw() as SQSClient).send).toBe("function");
		expect(connection.deadLettersNatively).toBe(true);
	}, T);

	it("is started, restarted on a changed spec and stopped by the manager", async () => {
		const url = await queue();
		const manager = new QueueConnectionManager(async () => ({ createConnection }));
		const { handler, values } = recorder();
		const spec = { type: "sqs", config, subscription: subscription(url, { batchSize: 1 }) };

		await manager.start("t1", spec, handler);
		const firstConnection = manager.connection("t1");
		await manager.start("t1", spec, handler);
		expect(manager.connection("t1")).toBe(firstConnection);

		await send(url, numbered(0, 1));
		await until(() => values().length === 1);

		await manager.start("t1", { ...spec, subscription: { ...spec.subscription, batchSize: 5 } }, handler);
		expect(manager.connection("t1")).not.toBe(firstConnection);
		await send(url, numbered(1, 1));
		await until(() => values().length === 2);
		expect(values()).toEqual([0, 1]);

		await manager.close();
		expect(manager.has("t1")).toBe(false);
	}, T);
});
