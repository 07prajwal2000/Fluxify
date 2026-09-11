import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type Docker from "dockerode";
import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from "@nats-io/jetstream";
import { headers as natsHeaders, type NatsConnection } from "@nats-io/nats-core";
import { connect } from "@nats-io/transport-node";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import type { QueueBatch, QueueConnection, QueueHandler, QueueSubscription } from "./base";
import { assertNatsStream, connectOptions, createConnection, testNatsConnection, type NatsConfig, type NatsSource } from "./nats.ee";
import { QueueConnectionManager } from "./manager";

/**
 * The NATS connector against a real JetStream server with user/password auth.
 * Each test gets its own stream and consumer, so nothing one test acks is seen
 * by another.
 */

const IMAGE = "nats:2.14";
const CONTAINER = "fluxify-nats-test-suite";
const USER = "fluxify";
const PASS = "s3cret";
const T = 60_000;

let container: Docker.Container | undefined;
let config: NatsConfig;
let nc: NatsConnection;
let js: JetStreamClient;
let jsm: JetStreamManager;
const open: QueueConnection[] = [];
let seq = 0;

beforeAll(async () => {
	await docker.getContainer(CONTAINER).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			Cmd: ["-js", "--user", USER, "--pass", PASS],
			HostConfig: { PortBindings: { "4222/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "4222/tcp": {} },
		}),
	);
	container = started.container;
	config = { servers: `nats://localhost:${started.port}`, user: USER, pass: PASS, dlqSubject: "fluxify.dlq" };

	await until(async () => (await testNatsConnection(config)).success, 60_000);
	nc = await connect(connectOptions(config));
	js = jetstream(nc);
	jsm = await jetstreamManager(nc);
	await jsm.streams.add({ name: "DLQ", subjects: ["fluxify.dlq"] });
}, 180_000);

afterEach(async () => {
	await Promise.allSettled(open.splice(0).map((connection) => connection.stop()));
});

afterAll(async () => {
	await nc?.close().catch(() => {});
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

/** A fresh stream capturing `<name>.>`; returns its name, which is also the subject prefix. */
async function stream() {
	const name = `orders-${Date.now()}-${++seq}`;
	await jsm.streams.add({ name, subjects: [`${name}.>`] });
	return name;
}

type Outgoing = { value: unknown; subject?: string; id?: string; headers?: Record<string, string> };

async function send(to: string, messages: Outgoing[]) {
	for (const m of messages) {
		const h = natsHeaders();
		for (const [k, v] of Object.entries(m.headers ?? {})) h.set(k, v);
		const payload =
			m.value === null ? "" : typeof m.value === "string" ? m.value : JSON.stringify(m.value);
		await js.publish(`${to}.${m.subject ?? "new"}`, payload, { headers: h, ...(m.id ? { msgID: m.id } : {}) });
	}
}

const numbered = (from: number, count: number): Outgoing[] =>
	Array.from({ length: count }, (_, i) => ({ value: { n: from + i } }));

function subscription(name: string, settings: Partial<QueueSubscription> = {}, source: Partial<NatsSource> = {}) {
	return {
		source: { stream: name, fromBeginning: true, ackWaitMs: 2_000, ...source },
		consumerGroup: `fluxify-${name}`,
		batchSize: 10,
		maxWaitMs: 200,
		maxBytes: 1024 * 1024,
		concurrency: 1,
		...settings,
	} satisfies QueueSubscription;
}

async function start(sub: QueueSubscription, handler: QueueHandler, settings: Partial<NatsConfig> = {}) {
	const connection = createConnection({ ...config, ...settings });
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
	const values = () => batches.flatMap((b) => b.events.map((e) => (e.data as any)?.n));
	return { batches, handler, values };
}

/* ------------------------------------------------------------------- tests */

describe("testing a NATS integration", () => {
	it("succeeds against a live server", async () => {
		expect(await testNatsConnection(config)).toEqual({ success: true, error: "" });
	});

	it("fails when nothing is listening", async () => {
		const result = await testNatsConnection({ servers: "nats://localhost:1" });
		expect(result.success).toBe(false);
		expect(result.error).not.toBe("");
	}, T);

	it("reads a comma-separated server list, skipping blanks", async () => {
		expect((await testNatsConnection({ ...config, servers: ` ${config.servers} , ,` })).success).toBe(true);
	});

	it("is refused with the wrong password", async () => {
		expect((await testNatsConnection({ ...config, pass: "wrong" })).success).toBe(false);
	}, T);

	it("is refused with no credentials", async () => {
		expect((await testNatsConnection({ servers: config.servers })).success).toBe(false);
	}, T);
});

describe("checking a trigger's stream", () => {
	it("passes when the stream exists", async () => {
		await assertNatsStream(config, await stream());
	});

	it("names a missing stream", async () => {
		await expect(assertNatsStream(config, `missing-${++seq}`)).rejects.toThrow(/Could not read stream "missing-/);
	});

	it("says the servers could not be reached", async () => {
		await expect(assertNatsStream({ servers: "nats://localhost:1" }, "x")).rejects.toThrow(
			/Could not reach the NATS servers/,
		);
	}, T);
});

describe("consuming a stream", () => {
	it("hands over events with where they came from, decoding JSON, text and empty bodies", async () => {
		const name = await stream();
		await send(name, [
			{ value: { n: 1 }, id: "order-1", headers: { tenant: "acme" } },
			{ value: "plain text" },
			{ value: null },
		]);
		const { batches, handler } = recorder();
		await start(subscription(name, { batchSize: 3 }), handler);

		await until(() => batches.flatMap((b) => b.events).length === 3);
		const events = batches.flatMap((b) => b.events);
		expect(events.map((e) => e.data)).toEqual([{ n: 1 }, "plain text", null]);
		expect(events[0]).toMatchObject({ topic: `${name}.new`, partition: 0, offset: "1", key: "order-1" });
		expect(events[0]!.headers).toMatchObject({ tenant: "acme" });
		expect(events[1]!.key).toBeNull();
		expect(Number.isNaN(Date.parse(events[0]!.timestamp))).toBe(false);
		expect(batches[0]!).toMatchObject({ consumerGroup: `fluxify-${name}`, attempt: 1 });
	}, T);

	it("splits a backlog into batches of at most batchSize", async () => {
		const name = await stream();
		await send(name, numbered(0, 7));
		const { batches, handler, values } = recorder();
		await start(subscription(name, { batchSize: 3 }), handler);

		await until(() => values().length === 7);
		expect(values()).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(batches.every((b) => b.events.length <= 3)).toBe(true);
	}, T);

	it("ends a batch before it goes over maxBytes, but never sends an empty one", async () => {
		const name = await stream();
		const big = "x".repeat(700);
		await send(name, [{ value: big }, { value: big }, { value: big }]);
		const { batches, handler } = recorder();
		await start(subscription(name, { maxBytes: 1024 }), handler);

		await until(() => batches.flatMap((b) => b.events).length === 3);
		expect(batches.map((b) => b.events.length)).toEqual([1, 1, 1]);
	}, T);

	it("reads only the filtered subjects", async () => {
		const name = await stream();
		await send(name, [{ value: { n: 1 }, subject: "eu" }, { value: { n: 2 }, subject: "us" }]);
		const { handler, values } = recorder();
		await start(subscription(name, {}, { filterSubjects: [`${name}.us`] }), handler);

		await until(() => values().length === 1);
		await Bun.sleep(1_500);
		expect(values()).toEqual([2]);
	}, T);

	it("starts at the newest event when not reading from the beginning", async () => {
		const name = await stream();
		await send(name, numbered(0, 3));
		const { handler, values } = recorder();
		await start(subscription(name, {}, { fromBeginning: false }), handler);

		await send(name, numbered(100, 2));
		await until(() => values().length === 2);
		await Bun.sleep(500);
		expect(values()).toEqual([100, 101]);
	}, T);

	it("refuses a subscription with no stream", async () => {
		const connection = createConnection(config);
		await expect(connection.consume({ ...subscription("x"), source: {} }, async () => {})).rejects.toThrow(
			/needs a stream/,
		);
	});

	it("fails to start on a stream that does not exist", async () => {
		const connection = createConnection(config);
		open.push(connection);
		await expect(connection.consume(subscription(`missing-${++seq}`), async () => {})).rejects.toThrow();
	}, T);
});

describe("concurrency", () => {
	it("runs up to concurrency batches side by side, never more", async () => {
		const name = await stream();
		await send(name, numbered(0, 6));
		let running = 0;
		let peak = 0;
		let done = 0;
		await start(subscription(name, { batchSize: 1, concurrency: 2 }), async (batch, connection) => {
			peak = Math.max(peak, ++running);
			await Bun.sleep(100);
			running--;
			done++;
			await connection.commit(batch);
		});

		await until(() => done >= 6);
		await Bun.sleep(300);
		expect(done).toBe(6);
		expect(peak).toBe(2);
	}, T);
});

describe("delivery guarantees", () => {
	// JetStream redelivers each nak'd message on its own, so a retried batch is
	// not regrouped; one message keeps the check to what is guaranteed.
	it("delivers a message again, counting attempts, when the handler throws", async () => {
		const name = await stream();
		await send(name, numbered(0, 1));
		const attempts: string[] = [];
		await start(subscription(name), async (batch, connection) => {
			attempts.push(`${batch.attempt}:${batch.events.map((e) => e.offset).join(",")}`);
			if (attempts.length < 3) throw new Error("downstream is down");
			await connection.commit(batch);
		});

		await until(() => attempts.length === 3, 20_000);
		expect(attempts).toEqual(["1:1", "2:1", "3:1"]);
	}, T);

	it("resumes after a restart from the last ack, not from the beginning", async () => {
		const name = await stream();
		const sub = subscription(name, { batchSize: 5 });
		await send(name, numbered(0, 3));
		const first = recorder();
		const connection = await start(sub, first.handler);
		await until(() => first.values().length === 3);
		await connection.stop();

		await send(name, numbered(3, 2));
		const second = recorder();
		await start(sub, second.handler);
		await until(() => second.values().length === 2);
		await Bun.sleep(500);
		expect(second.values()).toEqual([3, 4]);
	}, T);

	it("runs an unacked batch again after its worker dies mid-batch", async () => {
		const name = await stream();
		const sub = subscription(name, { batchSize: 2 });
		await send(name, numbered(0, 4));
		const crashed = createConnection(config);
		const firstRun: number[][] = [];
		await crashed.consume(sub, async (batch, connection) => {
			const values = batch.events.map((e) => (e.data as any).n);
			firstRun.push(values);
			if (values.includes(2)) return new Promise<void>(() => {}); // stuck forever
			await connection.commit(batch);
		});
		await until(() => firstRun.flat().includes(2));
		// the process is gone: no nak, no heartbeat, so ack_wait lapses
		await (crashed.raw() as NatsConnection).close();

		const second = recorder();
		await start(sub, second.handler);
		await until(() => second.values().length === 2);
		expect(firstRun[0]).toEqual([0, 1]);
		expect(second.values()).toEqual([2, 3]);
	}, T);

	it("keeps a slow batch to itself past ack_wait while the handler runs", async () => {
		const name = await stream();
		await send(name, numbered(0, 1));
		let runs = 0;
		await start(subscription(name, { concurrency: 2 }), async (batch, connection) => {
			runs++;
			await Bun.sleep(5_000); // more than twice ack_wait
			await connection.commit(batch);
		});
		await until(() => runs === 1);
		await Bun.sleep(6_000);
		expect(runs).toBe(1);
	}, T);

	it("acks nothing unless told to, so uncommitted work comes back", async () => {
		const name = await stream();
		const sub = subscription(name, { batchSize: 5 });
		await send(name, numbered(0, 2));
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
	it("counts what is read but not yet acked, and drops to zero once it is", async () => {
		const name = await stream();
		await send(name, numbered(0, 4));
		const held: QueueBatch[] = [];
		const connection = await start(
			subscription(name, { batchSize: 2 }, { ackWaitMs: 30_000 }),
			async (batch, conn) => {
				if (held.length === 0) await conn.commit(batch);
				held.push(batch);
			},
		);

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
	it("parks a batch on the dead-letter subject with the original message and where it came from", async () => {
		const name = await stream();
		await send(name, [{ value: { n: 9 }, id: "order-9", headers: { tenant: "acme" } }]);
		let parked = false;
		await start(subscription(name), async (batch, connection) => {
			await connection.moveToDLQ(batch, new Error("card declined"));
			await connection.commit(batch);
			parked = true;
		});
		await until(() => parked);

		const reader = await js.consumers.get("DLQ");
		let found: any;
		for await (const m of await reader.fetch({ max_messages: 100, expires: 1_000 }))
			if (m.headers?.get("x-fluxify-topic") === `${name}.new`) found = m;

		expect(found.json()).toEqual({ n: 9 });
		expect(found.headers.get("tenant")).toBe("acme");
		expect(found.headers.get("x-fluxify-error")).toBe("Error: card declined");
		expect(found.headers.get("x-fluxify-offset")).toBe("1");
		expect(found.headers.get("x-fluxify-consumer-group")).toBe(`fluxify-${name}`);
	}, T);

	it("refuses to dead-letter when the integration has no dead-letter subject", async () => {
		const name = await stream();
		await send(name, numbered(0, 1));
		let failure: unknown;
		await start(
			subscription(name),
			async (batch, connection) => {
				failure ??= await connection.moveToDLQ(batch, "x").catch((e) => e);
				await connection.commit(batch);
			},
			{ dlqSubject: undefined },
		);
		await until(() => !!failure);
		expect(String(failure)).toMatch(/dead-letter subject/);
	}, T);
});

describe("lifecycle", () => {
	it("exposes the underlying client", async () => {
		const name = await stream();
		const connection = await start(subscription(name), async () => {});
		expect(typeof (connection.raw() as NatsConnection).publish).toBe("function");
	}, T);

	it("is started, restarted on a changed spec and stopped by the manager", async () => {
		const name = await stream();
		const manager = new QueueConnectionManager(async () => ({ createConnection }));
		const { handler, values } = recorder();
		const spec = { type: "nats", config, subscription: subscription(name, { batchSize: 1 }) };

		await manager.start("t1", spec, handler);
		const firstConnection = manager.connection("t1");
		await manager.start("t1", spec, handler);
		expect(manager.connection("t1")).toBe(firstConnection);

		await send(name, numbered(0, 1));
		await until(() => values().length === 1);

		await manager.start("t1", { ...spec, subscription: { ...spec.subscription, batchSize: 5 } }, handler);
		expect(manager.connection("t1")).not.toBe(firstConnection);
		await send(name, numbered(1, 1));
		await until(() => values().length === 2);
		expect(values()).toEqual([0, 1]);

		await manager.close();
		expect(manager.has("t1")).toBe(false);
	}, T);
});
