import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	call,
	client,
	count,
	handleOf,
	installed,
	installRoute,
	installWorkflow,
	LIVENESS_SECONDS,
	newKey,
	ok,
	release,
	runsOf,
	saw,
	stack,
	startStreaming,
	stopStreaming,
	until,
} from "../src/streaming";
import { api } from "../src/envs";

// SSE and stopping an agent (#1041), as a client sees them: real graphs, routes on
// one worker and workflows on another, and the real HTTP path. A stream's socket is
// on the route worker, so every event a workflow sends crosses the broker.

const BROKERS = {
	nats: () => ({
		group: "queue",
		variant: "NATS",
		config: { servers: stack.nats.servers, token: stack.nats.token },
	}),
	redis: () => ({
		group: "kv",
		variant: "Redis",
		config: { source: "url", url: `redis://127.0.0.1:${stack.redisPort}` },
	}),
};

const paths = {
	nats: "/sse/nats",
	redis: "/sse/redis",
	takeover: "/sse/takeover",
	connect: "/sse/connect",
	silent: "/sse/silent",
	noBroker: "/sse/no-broker",
	chat: "/chat",
	stop: "/chat/stop",
};
let agent: string;

beforeAll(async () => {
	await startStreaming();
	const broker = async (name: keyof typeof BROKERS) => {
		const { group, variant, config } = BROKERS[name]();
		const body = { name, group, variant, config, syncDev: true };
		const { id } = await ok(api(stack, "creator", `/v1/${stack.projectId}/integrations`, { body }));
		return id as string;
	};
	const nats = await broker("nats");
	const redis = await broker("redis");

	const streamer = await installWorkflow("sseStream");
	const watcher = await installWorkflow("sseWatch");
	agent = await installWorkflow("agentLoop");

	await installRoute("sse/stream", paths.nats, { workflowId: streamer, brokerId: nats });
	await installRoute("sse/stream", paths.redis, { workflowId: streamer, brokerId: redis });
	await installRoute("sse/stream", paths.takeover, { workflowId: watcher, brokerId: nats });
	await installRoute("sse/connect", paths.connect, { brokerId: nats });
	await installRoute("sse/connect", paths.silent, { brokerId: nats });
	await installRoute("sse/connect", paths.noBroker);
	await installRoute("sse/stream", paths.chat, { workflowId: agent, brokerId: nats });
	await installRoute("sse/stop", paths.stop);
	await installed();
}, 600_000);

afterAll(stopStreaming);

describe.each(["nats", "redis"] as const)("a workflow streaming over %s", (broker) => {
	it("reaches the client in order, then ends the stream", async () => {
		const k = newKey();
		const events = client(paths[broker], { k });
		const handle = await handleOf(events);
		await release(k);

		await until("the stream to end", () => events.ended);

		expect(events.status).toBe(200);
		// without the comments a stream opens with and keeps alive on
		expect(events.text.replace(/^: \w+\n\n/gm, "")).toBe(
			`data: ${JSON.stringify({ k, handle })}\n\n` +
				"event: token\nid: 1\ndata: one\n\n" +
				'event: token\nid: 2\ndata: {"n":2}\n\n',
		);
	}, 60_000);
});

describe("a second call with the same id", () => {
	it("takes the stream over, and later sends reach only the second", async () => {
		const k = newKey();
		const first = client(paths.takeover, { k });
		await handleOf(first);
		await saw(k, "watching");

		const second = client(paths.connect, { k });

		await until("the first socket to close", () => first.ended);
		await saw(k, "signal");
		await handleOf(second);
		await release(k);
		await until("the second to end", () => second.ended);
		expect(second.text).toContain("data: after");
		expect(first.text).not.toContain("data: after");
	}, 60_000);
});

describe("when something goes wrong", () => {
	it("a silent stream gets an error event and closes at the liveness timeout", async () => {
		const started = Date.now();
		const events = client(paths.silent, { k: newKey() });

		await until("the stream to end", () => events.ended);

		expect(events.text).toContain('event: error\ndata: {"message":"SSE stream timed out"}');
		expect(Date.now() - started).toBeGreaterThanOrEqual(LIVENESS_SECONDS * 1000 - 100);
	}, 60_000);

	it("connect on a route with no broker answers with the documented error", async () => {
		const res = await until("the route to be served", async () => {
			const answer = await call(paths.noBroker, { k: newKey() });
			return answer.status !== 404 && answer;
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.text).toContain("SSE needs a broker integration in route settings");
	}, 60_000);
});

describe("stopping an agent mid-run", () => {
	it("ends the run and the stream, with nothing after, no handler, no retry, recorded as cancelled", async () => {
		const k = newKey();
		const events = client(paths.chat, { k });
		const handle = await handleOf(events);
		await until("the agent to stream", () => events.text.includes("data: tick 1"));

		const res = await call(paths.stop, { k, handle });

		expect(res.status).toBe(200);
		await until("the stream to end", () => events.ended);
		const [run] = await until("the run to be recorded", async () => {
			const runs = await runsOf(agent);
			return runs.length > 0 && runs;
		});
		expect(run!.outcome).toBe("cancelled");
		expect(run!.spanCount).toBeGreaterThan(0);

		// past the retry delay and a turn's length: a retried or live run would show here
		const ticks = count(k, "tick");
		await Bun.sleep(1_000);
		expect(count(k, "tick")).toBe(ticks);
		expect(count(k, "start")).toBe(1);
		expect(count("all", "after")).toBe(0);
		expect(count("all", "rescued")).toBe(0);
		expect(await runsOf(agent)).toHaveLength(1);
	}, 60_000);
});
