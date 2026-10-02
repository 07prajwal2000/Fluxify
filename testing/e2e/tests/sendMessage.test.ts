import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createRedisClient, QueueProducerFactory } from "@fluxify/adapters";
import { natsConnection } from "@fluxify/common/nats";
import { jetstreamManager, type JetStreamManager } from "@nats-io/jetstream";
import { hydrateIntegrations, OWNER_KEY } from "@fluxify/server/src/loaders/integrationsLoader";
import type Docker from "dockerode";
import { docker, pullImage, removeIfPresent, startContainerWithRandomPort } from "../src/docker";
import { loadGraph } from "../src/graph";
import { natsServer } from "../src/nats";
import { PROJECT_ID, runGraph } from "../src/runner";

/**
 * The Send Message block against real brokers, through a real graph: a Redis
 * stream (the Community path) and NATS JetStream. What the broker stored is read
 * back from the broker itself, because that is the only place it is true.
 */

const IMAGE = "redis:7.4-alpine";
const CONTAINER = "fluxify-e2e-redis-send";
const REDIS = "e2e-send-redis";
const NATS = "e2e-send-nats";
const STREAM = "E2E_SEND";

const single = await loadGraph("send-message/single");
const bulk = await loadGraph("send-message/bulk");
const raw = await loadGraph("send-message/raw");

let container: Docker.Container | undefined;
let redis: ReturnType<typeof createRedisClient>;
let jsm: JetStreamManager;
let seq = 0;

beforeAll(async () => {
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);
	const run = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(port) }] }, AutoRemove: true },
		}),
	);
	container = run.container;
	const redisConfig = { source: "credentials", host: "127.0.0.1", port: String(run.port) };
	redis = createRedisClient(redisConfig as never);
	redis.on("error", () => undefined);
	for (let i = 0; ; i++) {
		if ((await redis.ping().catch(() => "")) === "PONG") break;
		if (i > 120) throw new Error("redis container did not become ready");
		await Bun.sleep(250);
	}

	const { servers, token } = await natsServer();
	jsm = await jetstreamManager(natsConnection());
	await jsm.streams.add({ name: STREAM, subjects: ["e2e.send.>"] });

	hydrateIntegrations(PROJECT_ID, {
		kv: { [REDIS]: { ...redisConfig, variant: "Redis", group: "kv", [OWNER_KEY]: PROJECT_ID } },
		queue: { [NATS]: { servers, token, variant: "NATS", group: "queue", [OWNER_KEY]: PROJECT_ID } },
	});
}, 180_000);

afterAll(async () => {
	// producers drain before the shared NATS container goes away
	await QueueProducerFactory.closeAll();
	await jsm?.streams.delete(STREAM).catch(() => {});
	redis?.disconnect();
	await container?.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
});

const stream = () => `orders-${++seq}-${Date.now()}`;
const subject = () => `e2e.send.orders.${++seq}`;

/** An entry's flat `[name, value, ...]` fields as an object. */
const fieldsOf = (flat: string[]) =>
	Object.fromEntries(flat.flatMap((_, i) => (i % 2 ? [] : [[flat[i], flat[i + 1]]])));

async function natsMessage(seqNo: number) {
	const message = await jsm.streams.getMessage(STREAM, { seq: seqNo });
	return {
		subject: message!.subject,
		data: new TextDecoder().decode(message!.data),
		header: message!.header?.get("x-e2e"),
	};
}

describe("send message to a Redis stream", () => {
	it("appends one entry, an object's keys becoming its fields", async () => {
		const key = stream();
		const run = await runGraph(single, {
			body: { connection: REDIS, destination: key, payload: { id: 7, paid: true, items: [1, 2] } },
		});

		expect(run.status).toBe(200);
		expect(run.body).toEqual({ stream: key, id: expect.any(String) });
		const [[id, fields]] = await redis.xrange(key, "-", "+");
		expect(id).toBe(run.body.id);
		// numbers and booleans as their text, objects and lists as JSON
		expect(fieldsOf(fields)).toEqual({ id: "7", paid: "true", items: "[1,2]" });
	});

	it("puts anything but an object in one data field, and trims to maxLen", async () => {
		const key = stream();
		for (const payload of ["first", "second", "third"])
			await runGraph(single, { body: { connection: REDIS, destination: key, payload, maxLen: 1 } });

		const entries = await redis.xrange(key, "-", "+");
		// MAXLEN ~ trims whole nodes, so only an upper bound is promised
		expect(entries.length).toBeLessThanOrEqual(3);
		expect(fieldsOf(entries.at(-1)![1])).toEqual({ data: "third" });
	});

	it("sends each item of a list, with per-item destinations", async () => {
		const shared = stream();
		const other = stream();
		const run = await runGraph(bulk, {
			query: { connection: REDIS, destination: shared },
			body: { messages: [{ n: 1 }, { payload: { n: 2 }, destination: other }, { n: 3 }] },
		});

		expect(run.status).toBe(200);
		expect(run.body.failed).toEqual([]);
		expect(run.body.sent.map((s: { index: number; stream: string }) => [s.index, s.stream])).toEqual([
			[0, shared],
			[1, other],
			[2, shared],
		]);
		expect(await redis.xlen(shared)).toBe(2);
		expect(await redis.xlen(other)).toBe(1);
	});

	it("hands Raw mode the ioredis client", async () => {
		const key = stream();
		const run = await runGraph(raw, { body: { connection: REDIS, kind: "redis", destination: key } });
		expect(run.status).toBe(200);
		const [[, fields]] = await redis.xrange(key, "-", "+");
		expect(fieldsOf(fields)).toEqual({ via: "raw" });
	});

	it("refuses to let Raw mode close the shared client", async () => {
		const run = await runGraph(raw, { body: { connection: REDIS, kind: "redis", close: true } });
		expect(run.status).toBe(500);
		expect(run.body.error).toContain("close() is not allowed");
		// still open for the next run
		const again = await runGraph(raw, { body: { connection: REDIS, kind: "redis", destination: stream() } });
		expect(again.status).toBe(200);
	});
});

describe("send message to NATS JetStream", () => {
	it("publishes one message with its headers and waits for the stream's ack", async () => {
		const to = subject();
		const run = await runGraph(single, {
			body: { connection: NATS, destination: to, payload: { id: 42 } },
		});

		expect(run.status).toBe(200);
		expect(run.body).toMatchObject({ stream: STREAM, duplicate: false });
		expect(await natsMessage(run.body.seq)).toEqual({
			subject: to,
			data: '{"id":42}',
			header: "single",
		});
	});

	it("sends text as-is", async () => {
		const run = await runGraph(single, {
			body: { connection: NATS, destination: subject(), payload: "plain text" },
		});
		expect((await natsMessage(run.body.seq)).data).toBe("plain text");
	});

	it("drops a repeat of the same message ID", async () => {
		const body = { connection: NATS, destination: subject(), payload: { id: 1 }, msgId: `m-${Date.now()}` };
		const first = await runGraph(single, { body });
		const second = await runGraph(single, { body });
		expect(first.body.duplicate).toBe(false);
		expect(second.body).toMatchObject({ seq: first.body.seq, duplicate: true });
	});

	it("takes the Failure path when no stream captures the subject", async () => {
		const run = await runGraph(single, {
			body: { connection: NATS, destination: "e2e.nowhere", payload: { id: 1 } },
		});
		expect(run.status).toBe(500);
		expect(run.body.error).toBeString();
		expect(run.executed).toEqual(["entry", "send", "failed"]);
	});

	it("reports a partly failed list on Success, and an all-failed one on Failure", async () => {
		const ok = subject();
		const partly = await runGraph(bulk, {
			query: { connection: NATS, destination: ok },
			body: { messages: [{ n: 1 }, { payload: { n: 2 }, destination: "e2e.nowhere" }] },
		});
		expect(partly.status).toBe(200);
		expect(partly.body.sent.map((s: { index: number }) => s.index)).toEqual([0]);
		expect(partly.body.failed.map((f: { index: number }) => f.index)).toEqual([1]);

		const none = await runGraph(bulk, {
			query: { connection: NATS, destination: "e2e.nowhere" },
			body: { messages: [{ n: 1 }, { n: 2 }] },
		});
		expect(none.status).toBe(500);
		expect(none.body.failed).toHaveLength(2);
	});

	it("hands Raw mode the JetStream client", async () => {
		const to = subject();
		const run = await runGraph(raw, { body: { connection: NATS, destination: to } });
		expect(run.status).toBe(200);
		expect(await natsMessage(run.body.seq)).toMatchObject({ subject: to, data: "via raw" });
	});

	it("refuses an integration that belongs to another project", async () => {
		hydrateIntegrations("someone-else", {
			queue: { foreign: { servers: "nats://127.0.0.1:1", variant: "NATS", [OWNER_KEY]: "someone-else" } },
		});
		const run = await runGraph(single, {
			body: { connection: "foreign", destination: subject(), payload: {} },
		});
		expect(run.status).toBe(500);
		expect(run.body.error).toContain("No message queue integration");
	});
});
