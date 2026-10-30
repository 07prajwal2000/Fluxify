import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { compileGraph, registerModuleBlock } from "@fluxify/blocks";
import type Docker from "dockerode";
import { hydrateIntegrations, OWNER_KEY } from "../../../loaders/integrationsLoader";
import { createJobContext } from "../service";
import { closeSseBrokers, createSseApi } from "../sseRuntime";
import { NO_PERMISSIONS, withGrantedContext } from "../pluginPermissions";
import { pluginWorkflowGraph, SSE_PLUGIN_BLOCK, workflowGraph } from "./sseGraphs";

/**
 * SSE across processes, over real brokers (#1023). Each route node is its own
 * process (`sseNode.fixture.ts`) holding the client's socket; this process is
 * the other node, running a compiled workflow that sends with the handle, and
 * a plugin block that streams with `ctx.sse` (#1025).
 */

const FIXTURE = fileURLToPath(new URL("./sseNode.fixture.ts", import.meta.url));

type Broker = { name: string; image: string; port: number; cmd?: string[]; group: string; config: (port: number) => object };
const BROKERS: Broker[] = [
	{
		name: "nats",
		image: "nats:2.14",
		port: 4222,
		group: "queue",
		config: (port) => ({ variant: "NATS", servers: `nats://localhost:${port}` }),
	},
	{
		name: "redis",
		image: "valkey/valkey:8-alpine",
		port: 6379,
		group: "kv",
		config: (port) => ({ variant: "Redis", source: "url", url: `redis://localhost:${port}` }),
	},
];

/** keeps tests sharing a broker apart; faker is not a dependency of this package */
const rand = () => crypto.randomUUID().slice(0, 8);
const PROJECT = `p_${rand()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean | Promise<boolean>, ms = 10_000) {
	const deadline = Date.now() + ms;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error("timed out");
		await sleep(50);
	}
}

/** a route node in its own process */
async function startNode(setup: object) {
	const child = Bun.spawn([process.execPath, FIXTURE, JSON.stringify(setup)], {
		stdout: "pipe",
		stderr: "inherit",
		env: { ...process.env, NODE_ENV: "test" },
	});
	const reader = child.stdout.getReader();
	let out = "";
	while (!/READY (\d+)/.test(out)) {
		const { value, done } = await reader.read();
		if (done) throw new Error(`node exited: ${out}`);
		out += new TextDecoder().decode(value);
	}
	return { child, url: `http://localhost:${/READY (\d+)/.exec(out)![1]}` };
}

/** an EventSource-like client: everything the stream sent so far, and whether it ended */
function client(url: string) {
	const abort = new AbortController();
	const state = { text: "", ended: false, abort: () => abort.abort() };
	void (async () => {
		const response = await fetch(url, { signal: abort.signal });
		const reader = response.body!.getReader();
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			state.text += new TextDecoder().decode(value);
		}
	})()
		.catch(() => undefined)
		.finally(() => {
			state.ended = true;
		});
	return state;
}

/** the plugin path a worker takes, with no permissions: `ctx.sse` needs none (#1025) */
const MAX_TOKENS = 200;
const META = { handles: { in: ["target"], out: ["source"], body: [] } } as never;
let streamed: { sent: number; aborted: boolean } | undefined;
registerModuleBlock(
	PROJECT,
	SSE_PLUGIN_BLOCK,
	withGrantedContext(
		async ({ params, ctx }) => {
			const signal = ctx.sse!.signal(params.handle);
			let sent = 0;
			while (!signal.aborted && sent < MAX_TOKENS) {
				await ctx.sse!.send(params.handle, `t${sent++}`, { event: "token" });
				await sleep(50);
			}
			streamed = { sent, aborted: signal.aborted };
		},
		NO_PERMISSIONS,
		`block ${SSE_PLUGIN_BLOCK}`,
	),
	META,
);
const pluginWorkflow = compileGraph(pluginWorkflowGraph().blocks, pluginWorkflowGraph().edges, {
	asWorkflow: true,
	projectId: PROJECT,
	blockMeta: { [SSE_PLUGIN_BLOCK]: META },
});

describe.each(BROKERS)("SSE runtime across processes on $name", (broker) => {
	const container = `fluxify-sse-runtime-${broker.name}-test`;
	const brokerId = `int_${rand()}`;
	let started: Docker.Container | undefined;
	let nodes: Awaited<ReturnType<typeof startNode>>[] = [];
	const workflow = compileGraph(workflowGraph().blocks, workflowGraph().edges, { asWorkflow: true });

	const runWorkflow = (payload: object) =>
		workflow.run(createJobContext({ id: crypto.randomUUID(), projectId: PROJECT, target: "wf", payload }), payload);

	beforeAll(async () => {
		await docker.getContainer(container).remove({ force: true }).catch(() => {});
		await pullImage(broker.image);
		const result = await startContainerWithRandomPort((port) =>
			docker.createContainer({
				Image: broker.image,
				name: container,
				ExposedPorts: { [`${broker.port}/tcp`]: {} },
				HostConfig: { PortBindings: { [`${broker.port}/tcp`]: [{ HostPort: String(port) }] } },
			}),
		);
		started = result.container;
		const config = broker.config(result.port);
		hydrateIntegrations(PROJECT, { [broker.group]: { [brokerId]: { ...config, [OWNER_KEY]: PROJECT } } });
		// ready once a publish goes through
		await until(() => createSseApi({ projectId: PROJECT }).send(`${brokerId}:ping`, "x"), 60_000);
		const setup = { projectId: PROJECT, brokerId, group: broker.group, config };
		nodes = await Promise.all([startNode(setup), startNode(setup)]);
	}, 180_000);

	afterAll(async () => {
		for (const node of nodes) node.child.kill();
		await closeSseBrokers();
		if (started) await started.remove({ force: true }).catch(() => {});
	});

	it("a workflow in another process streams to the route's client, then closes it", async () => {
		const id = `conv:${rand()}`;
		const handle = `${brokerId}:${id}`;
		const events = client(`${nodes[0]!.url}/chat?id=${encodeURIComponent(id)}`);
		await until(() => events.text.includes(`data: connected ${handle}`));
		await runWorkflow({ handle, tokens: ["Hel", "lo\nworld", { done: true }], close: true });
		await until(() => events.ended);
		expect(events.text).toContain(
			'event: token\ndata: Hel\n\nevent: token\ndata: lo\ndata: world\n\nevent: token\ndata: {"done":true}\n\n',
		);
	}, 30_000);

	it("connecting on another process takes the id over and closes the old socket", async () => {
		const id = rand();
		const handle = `${brokerId}:${id}`;
		const first = client(`${nodes[0]!.url}/chat?id=${id}`);
		await until(() => first.text.includes("data: connected"));
		const second = client(`${nodes[1]!.url}/chat?id=${id}`);
		await until(() => second.text.includes("data: connected"));
		await until(() => first.ended);
		await runWorkflow({ handle, tokens: ["after"], close: true });
		await until(() => second.ended);
		expect(second.text).toContain("data: after");
		expect(first.text).not.toContain("data: after");
	}, 30_000);

	it("the client leaving fires signal in another process", async () => {
		const id = rand();
		const events = client(`${nodes[1]!.url}/chat?id=${id}`);
		await until(() => events.text.includes("data: connected"));
		const signal = createSseApi({ projectId: PROJECT }).signal(`${brokerId}:${id}`);
		// the watch subscribes in the background; give the broker a moment to hold it
		await sleep(300);
		expect(signal.aborted).toBe(false);
		events.abort();
		await until(() => signal.aborted);
	}, 30_000);

	it("send reads false after the client leaves and true after it reconnects on another process", async () => {
		const id = rand();
		const handle = `${brokerId}:${id}`;
		const producer = createSseApi({ projectId: PROJECT });
		const first = client(`${nodes[0]!.url}/chat?id=${id}`);
		await until(() => first.text.includes("data: connected"));
		expect(await producer.send(handle, "one")).toBe(true);
		first.abort();
		await until(async () => !(await producer.send(handle, "gone")));
		const second = client(`${nodes[1]!.url}/chat?id=${id}`);
		await until(() => second.text.includes("data: connected"));
		await until(() => producer.send(handle, "back"));
		await until(() => second.text.includes("data: back"));
		second.abort();
	}, 30_000);

	it("a plugin block streams with ctx.sse and stops on signal when the client leaves", async () => {
		const id = rand();
		const events = client(`${nodes[0]!.url}/chat?id=${id}`);
		await until(() => events.text.includes("data: connected"));
		streamed = undefined;
		const run = pluginWorkflow.run(
			createJobContext({ id: rand(), projectId: PROJECT, target: "wf", payload: {} }),
			{ handle: `${brokerId}:${id}` },
		);
		await until(() => events.text.includes("data: t2"));
		events.abort();
		await run;
		expect(streamed?.aborted).toBe(true);
		expect(streamed!.sent).toBeLessThan(MAX_TOKENS);
	}, 30_000);
});
