import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { BlockDTOType, EdgeDTOSchemaType } from "@fluxify/blocks";
import { createRedisClient, KvFactory } from "@fluxify/adapters";
import { hydrateIntegrations, OWNER_KEY } from "@fluxify/server/src/loaders/integrationsLoader";
import type Docker from "dockerode";
import { connectionFor, resetDatabase } from "../src/engines";
import { docker, pullImage, removeIfPresent, startContainerWithRandomPort } from "../src/docker";
import type { GraphFixture } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * Two projects on one worker (`WORKER_PROJECT_ID=*`) share the integration caches,
 * which are keyed by integration id alone. A route may only reach the integrations
 * its own project owns (or unowned ones), whatever id its block names.
 *
 * Run through the real request path against a real Postgres and a real Redis: a
 * mock proves what the factory is asked, not that a foreign tenant's credentials
 * stay out of reach of a block that names them.
 */

const IMAGE = "redis:7.4-alpine";
const CONTAINER = "fluxify-e2e-redis-tenants";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
// ids unique to this file: the caches are process-wide and other files share them
const A_DB = "tenants-a-db";
const B_DB = "tenants-b-db";
const SHARED_DB = "tenants-shared-db";
const A_KV = "tenants-a-kv";
const B_KV = "tenants-b-kv";
const SHARED_KV = "tenants-shared-kv";
const SECRET_KEY = "tenants:secret";
const SECRET = "belongs-to-tenant-b";

let container: Docker.Container | undefined;
let redis: ReturnType<typeof createRedisClient>;

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
	await redis.set(SECRET_KEY, SECRET);

	const pg = await connectionFor("pg");
	const kv = (owner: string | null) => ({
		...redisConfig,
		variant: "Redis",
		group: "kv",
		[OWNER_KEY]: owner,
	});
	hydrateIntegrations(TENANT_A, {
		db: { [A_DB]: { ...pg, [OWNER_KEY]: TENANT_A } },
		kv: { [A_KV]: kv(TENANT_A) },
	});
	hydrateIntegrations(TENANT_B, {
		db: { [B_DB]: { ...pg, [OWNER_KEY]: TENANT_B } },
		kv: { [B_KV]: kv(TENANT_B) },
	});
	// an unowned row is usable by every project
	hydrateIntegrations("tenants-unowned", {
		db: { [SHARED_DB]: { ...pg, [OWNER_KEY]: null } },
		kv: { [SHARED_KV]: kv(null) },
	});
}, 180_000);

afterAll(async () => {
	// leave the shared caches as this file found them
	for (const project of [TENANT_A, TENANT_B, "tenants-unowned"])
		hydrateIntegrations(project, { db: {}, kv: {} });
	await KvFactory.ResetConnections().catch(() => {});
	redis?.disconnect();
	await container?.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
});

beforeEach(() => resetDatabase("pg"));

const block = (id: string, type: string, data: Record<string, unknown> = {}): BlockDTOType =>
	({ id, type, data, position: { x: 0, y: 0 } }) as BlockDTOType;

const edges: EdgeDTOSchemaType = [
	{ id: "e1", from: "entry", to: "read", fromHandle: "source", toHandle: "source" },
	{ id: "e2", from: "read", to: "reply", fromHandle: "source", toHandle: "source" },
];

/** a one-block route in `project` that reads through the integration named `connection` */
function route(project: string, reader: BlockDTOType): GraphFixture {
	return {
		name: `tenants/${project}/${reader.type}`,
		description: "reads through an integration that may belong to another project",
		engine: "none", // the test hydrates its own integrations
		projectId: project,
		route: { method: "GET", path: "/read" },
		blocks: [
			block("entry", "entrypoint"),
			reader,
			block("reply", "response", { httpCode: "200" }),
		],
		edges,
	};
}

const readUsers = (project: string, connection: string) =>
	route(
		project,
		block("read", "db_getall", {
			connection,
			tableName: "users",
			conditions: [],
			columns: ["id", "name", "email"],
			limit: 100,
			offset: 0,
			sort: { attribute: "id", direction: "asc" },
		}),
	);

const readKey = (project: string, connection: string) =>
	route(project, block("read", "kv_operations", { connection, operation: "get", key: SECRET_KEY }));

describe("database integrations are scoped to the project", () => {
	it("serves a project its own integration", async () => {
		const run = await runGraph(readUsers(TENANT_A, A_DB));
		expect(run.status).toBe(200);
		expect(run.body).toHaveLength(3);
	});

	it("serves an unowned integration to any project", async () => {
		const run = await runGraph(readUsers(TENANT_A, SHARED_DB));
		expect(run.status).toBe(200);
		expect(run.body).toHaveLength(3);
	});

	it("refuses another project's integration, and returns none of its rows", async () => {
		const run = await runGraph(readUsers(TENANT_A, B_DB));

		expect(run.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(run.body)).not.toContain("ada@example.com");
		// the read never succeeded, so nothing downstream saw a row
		expect(run.spans.find((span) => span.blockId === "read")?.outcome).not.toBe("success");
	});

	it("holds in both directions", async () => {
		expect((await runGraph(readUsers(TENANT_B, B_DB))).status).toBe(200);
		expect((await runGraph(readUsers(TENANT_B, A_DB))).status).toBeGreaterThanOrEqual(400);
	});
});

describe("key-value integrations are scoped to the project", () => {
	it("serves a project its own integration", async () => {
		const run = await runGraph(readKey(TENANT_B, B_KV));
		expect(run.status).toBe(200);
		expect(run.body).toBe(SECRET);
	});

	it("serves an unowned integration to any project", async () => {
		const run = await runGraph(readKey(TENANT_A, SHARED_KV));
		expect(run.status).toBe(200);
		expect(run.body).toBe(SECRET);
	});

	it("refuses another project's integration, and reads nothing from it", async () => {
		const run = await runGraph(readKey(TENANT_A, B_KV));

		expect(run.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(run.body)).not.toContain(SECRET);
	});

	it("does not let a client opened for the owner be reused by another project", async () => {
		// KvFactory keeps one client per integration id for the whole process, so the
		// owner's request must not make a later foreign one succeed
		expect((await runGraph(readKey(TENANT_B, B_KV))).status).toBe(200);
		const foreign = await runGraph(readKey(TENANT_A, B_KV));
		expect(foreign.status).toBeGreaterThanOrEqual(400);
		expect(JSON.stringify(foreign.body)).not.toContain(SECRET);
	});
});

describe("a foreign id is indistinguishable from a missing one", () => {
	it("fails the same way for another project's id and for an id nobody has", async () => {
		const foreign = await runGraph(readUsers(TENANT_A, B_DB));
		const missing = await runGraph(readUsers(TENANT_A, "tenants-no-such-db"));

		expect(foreign.status).toBe(missing.status);
		expect(foreign.body).toEqual(missing.body);
	});
});
