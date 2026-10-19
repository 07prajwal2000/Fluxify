import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { RedisClient } from "bun";
import { faker } from "@faker-js/faker";
import type Docker from "dockerode";
// subpath import on purpose: the container helpers are test-only and are
// deliberately not re-exported from the package barrel
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { BlockTypes } from "./blockTypes";
import { block, createContext, edge } from "./builtin/tests/compilerTestHelpers";
import { compileGraph } from "./compiler";
import { closeCtxPools } from "./builtin/ctxPool";
import { customBlockNames, registerModuleBlock, unregisterBlock } from "./builtin/customBlock";

/**
 * Graph-level integration test for `ctx.pool` (plugins R6): a programmable block
 * pools a real Redis client. The server's own client count is what proves the
 * client is reused across requests and really closed when idle: a mock only
 * shows what the block asked for, never that a socket opened or went away.
 */

const REDIS_IMAGE = "valkey/valkey:8-alpine";
const REDIS_CONTAINER = "fluxify-ctx-pool-redis-test";
const PROJECT = "proj-pool";
const TYPE = "acme/demo/counter";
const IDLE_MS = 400;

let redisContainer: Docker.Container | undefined;
let admin: RedisClient;
let redisUrl: string;
let created = 0;

async function removeIfPresent(name: string) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
}

/** clients the server sees right now, this test's admin connection included */
async function connectedClients() {
	const info = String(await admin.send("INFO", ["clients"]));
	return Number(/connected_clients:(\d+)/.exec(info)?.[1]);
}

async function waitForClients(count: number) {
	for (let attempt = 0; attempt < 50; attempt++) {
		if ((await connectedClients()) === count) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(await connectedClients()).toBe(count);
}

beforeAll(async () => {
	await removeIfPresent(REDIS_CONTAINER);
	await pullImage(REDIS_IMAGE);
	const redis = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: REDIS_IMAGE,
			name: REDIS_CONTAINER,
			HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] } },
		}),
	);
	redisContainer = redis.container;
	redisUrl = `redis://127.0.0.1:${redis.port}`;
	admin = new RedisClient(redisUrl);
	// a container that accepts TCP is not a server that answers commands
	let ready = false;
	for (let attempt = 0; attempt < 60 && !ready; attempt++) {
		try {
			ready = (await admin.send("PING", [])) === "PONG";
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	if (!ready) throw new Error("Redis container did not become ready in time.");
}, 120_000);

// each test starts with only the admin connection open
afterEach(async () => {
	await closeCtxPools();
	await waitForClients(1);
});

afterAll(async () => {
	await closeCtxPools();
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
	admin?.close();
	await removeIfPresent(REDIS_CONTAINER);
	redisContainer = undefined;
});

/** entry -> counter block -> response, as a user wires it */
function counterRoute(counterKey: string) {
	const meta = { handles: { in: ["target"], out: ["source"], body: [] } } as any;
	registerModuleBlock(
		PROJECT,
		TYPE,
		async ({ ctx, params }) => {
			const client = await ctx.pool!("redis", params.conn, {
				create: (cfg) => {
					created++;
					return new RedisClient(cfg.url);
				},
				destroy: (c) => c.close(),
				idleMs: IDLE_MS,
			});
			return { output: await client.incr(counterKey) };
		},
		meta,
	);
	const { run } = compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", TYPE as any, { conn: { url: redisUrl, run: counterKey } }),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
		{ projectId: PROJECT, blockMeta: { [TYPE]: meta } },
	);
	return async () => (await run({ ...createContext(), projectId: PROJECT }, {})).output.body;
}

describe("ctx.pool over real Redis", () => {
	it("reuses one connection across requests and closes it once idle", async () => {
		const request = counterRoute(`pool:${faker.string.alphanumeric(8)}`);
		const before = await connectedClients(); // the admin connection
		const madeBefore = created;

		expect(await request()).toBe(1);
		expect(await request()).toBe(2);
		expect(await request()).toBe(3);
		expect(created - madeBefore).toBe(1);
		expect(await connectedClients()).toBe(before + 1);

		// no run holds a lease any more, so the idle timer closes the socket
		await waitForClients(before);

		// the next request builds a fresh client and carries on
		expect(await request()).toBe(4);
		expect(created - madeBefore).toBe(2);
		expect(await connectedClients()).toBe(before + 1);
	}, 30_000);

	it("closes the pooled connection on shutdown", async () => {
		const request = counterRoute(`pool:${faker.string.alphanumeric(8)}`);
		const before = await connectedClients();
		await request();
		expect(await connectedClients()).toBe(before + 1);

		await closeCtxPools();
		await waitForClients(before);
	}, 30_000);
});
