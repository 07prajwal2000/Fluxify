import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import {
	type Connection,
	DbConnectionManager,
	DbFactory,
	DbType,
	integrationRegistry,
	KvFactory,
} from "@fluxify/adapters";
// subpath import on purpose: the container helpers are test-only and are
// deliberately not re-exported from the package barrel
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { grantContext } from "@fluxify/sdk/runtime";
import { SQL } from "bun";
import { z } from "zod";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType } from "./builderTypes";
import {
	closeCtxIntegrations,
	type IntegrationFound,
	withCtxIntegrations,
} from "./builtin/ctxIntegrations";
import {
	customBlockNames,
	type ModuleBlockRun,
	registerModuleBlock,
	unregisterBlock,
} from "./builtin/customBlock";
import { compileGraph } from "./compiler";

/**
 * `ctx.integrations` (I4) against a real Postgres and Redis. A mock shows what
 * the block asked for; only the servers show that a plugin block shares the
 * transaction of the built-in blocks around it, that a pool is not rebuilt per
 * request, and that a Redis value written through `get<"kv">` is really there.
 */

const PG_IMAGE = "postgres:bullseye";
const REDIS_IMAGE = "valkey/valkey:8-alpine";
const PG_CONTAINER = "fluxify-ctx-integrations-pg-test";
const REDIS_CONTAINER = "fluxify-ctx-integrations-redis-test";
const PROJECT = "proj-ctx-integrations";
const TYPE = "acme/demo/writer";
const DB_ID = "db-conn";
const KV_ID = "kv-conn";
const FAKE_ID = "acme-conn";

let admin: SQL;
let manager: DbConnectionManager;
let kvFactory: KvFactory;
let dbConfig: Connection;
let table: string;
let acmeCreated = 0;

/** what the server's cache lookup answers, by id */
const found: Record<string, IntegrationFound> = {};

async function removeIfPresent(name: string) {
	await docker
		.getContainer(name)
		.remove({ force: true })
		.catch(() => {});
}

beforeAll(async () => {
	await removeIfPresent(PG_CONTAINER);
	await removeIfPresent(REDIS_CONTAINER);
	await pullImage(PG_IMAGE);
	await pullImage(REDIS_IMAGE);
	const pg = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: PG_IMAGE,
			name: PG_CONTAINER,
			Env: ["POSTGRES_USER=postgres", "POSTGRES_PASSWORD=12345", "POSTGRES_DB=testdb"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(port) }] } },
		}),
	);
	const redis = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: REDIS_IMAGE,
			name: REDIS_CONTAINER,
			HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(port) }] } },
		}),
	);
	dbConfig = {
		dbType: DbType.POSTGRES,
		host: "127.0.0.1",
		port: pg.port,
		username: "postgres",
		password: "12345",
		database: "testdb",
	} as Connection;

	// a container that accepts TCP is not a server that answers queries
	admin = new SQL(`postgres://postgres:12345@127.0.0.1:${pg.port}/testdb`, { max: 1 });
	let ready = false;
	for (let attempt = 0; attempt < 90 && !ready; attempt++) {
		try {
			await admin`SELECT 1`;
			ready = true;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	if (!ready) throw new Error("Postgres container did not become ready in time.");

	manager = new DbConnectionManager();
	kvFactory = new KvFactory({
		[KV_ID]: { variant: "Redis", host: "127.0.0.1", port: redis.port, source: "credentials" },
	});
	table = `orders_${faker.string.alphanumeric(8).toLowerCase()}`;
	await admin.unsafe(`CREATE TABLE ${table} (id SERIAL PRIMARY KEY, note TEXT NOT NULL)`);

	found[DB_ID] = { group: "database", variant: "PostgreSQL", config: dbConfig };
	found[KV_ID] = { group: "kv", variant: "Redis", config: {} };
	found[FAKE_ID] = { group: "acme/store", variant: "Fake", config: { region: "eu", noise: 1 } };
	// a plugin variant of its own group, created once per `poolKey`
	integrationRegistry.register({
		group: "acme/store",
		variant: "Fake",
		label: "Fake",
		configSchema: z.object({}),
		poolKey: (config: { region: string }) => config.region,
		create: () => ({ id: ++acmeCreated }),
	} as never);
}, 180_000);

afterEach(async () => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
	await closeCtxIntegrations();
});

afterAll(async () => {
	integrationRegistry.unregister("acme/store", "Fake");
	await KvFactory.ResetConnections().catch(() => {});
	await manager?.close().catch(() => {});
	await admin?.close().catch(() => {});
	await removeIfPresent(PG_CONTAINER);
	await removeIfPresent(REDIS_CONTAINER);
});

const block = (id: string, type: string, data: object = {}): BlockDTOType => ({
	id,
	type: type as BlockTypes,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string, toHandle = "source") => ({
	id: `edge-${from}-${to}-${toHandle}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});
const META = { handles: { in: ["target"], out: ["source"], body: [] } } as never;

/** the plugin loader's wrapper: the granted `ctx.integrations`, leases released when `run` settles */
function plugin(run: ModuleBlockRun, integrations: string[]) {
	registerModuleBlock(
		PROJECT,
		TYPE,
		async (args) => {
			const open = withCtxIntegrations(args.ctx, (id) => found[id]);
			try {
				const granted = { integrations, appconfig: false };
				return await run({
					...args,
					ctx: grantContext(open.ctx, granted, `block ${TYPE}`) as never,
				});
			} finally {
				open.release();
			}
		},
		META,
	);
}

type Graph = ReturnType<typeof compileGraph>["run"];

/** one request: a DbFactory of its own over the shared pool, disposed after */
async function request(graph: Graph) {
	const dbFactory = new DbFactory({ [DB_ID]: dbConfig }, manager);
	try {
		const ctx = {
			route: "/x",
			apiId: "a",
			projectId: PROJECT,
			vars: {},
			dbFactory,
			kvFactory,
		} as never;
		return await graph(ctx, {});
	} finally {
		dbFactory.dispose();
	}
}

const rows = async () =>
	(await admin.unsafe(`SELECT note FROM ${table} ORDER BY id`)).map(
		(r: { note: string }) => r.note,
	);

/** entry -> plugin block -> response */
function simple(): Graph {
	return compileGraph(
		[
			block("in", BlockTypes.entrypoint),
			block("p", TYPE),
			block("out", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("in", "p"), edge("p", "out")],
		{ projectId: PROJECT, blockMeta: { [TYPE]: META } },
	).run;
}

describe("ctx.integrations over real Postgres and Redis", () => {
	it("reads and writes through get<'database'> and get<'kv'>", async () => {
		const note = faker.string.alphanumeric(10);
		const key = `ci:${faker.string.alphanumeric(8)}`;
		plugin(
			async ({ ctx }) => {
				const db = await ctx.integrations!.get<"database">(DB_ID);
				const kv = await ctx.integrations!.get<"kv">(KV_ID);
				await db.raw(`INSERT INTO ${table} (note) VALUES ($1)`, [note]);
				await kv.set(key, note);
				return {
					output: {
						rows: await db.raw(`SELECT note FROM ${table} WHERE note = $1`, [note]),
						cached: await kv.get(key),
					},
				};
			},
			["database", "kv"],
		);
		const result = await request(simple());
		expect(result.output.body).toEqual({ rows: [{ note }], cached: note });
		expect(await rows()).toContain(note);
		expect(await kvFactory.getKvAdapter(KV_ID).get(key)).toBe(note);
	}, 30_000);

	it("a plugin block inside a built-in transaction takes part in it: the rollback removes its write", async () => {
		const note = faker.string.alphanumeric(10);
		plugin(
			async ({ ctx }) => {
				const db = await ctx.integrations!.get<"database">(DB_ID);
				await db.raw(`INSERT INTO ${table} (note) VALUES ($1)`, [note]);
				return { output: "written" };
			},
			["database"],
		);
		const { run } = compileGraph(
			[
				block("in", BlockTypes.entrypoint),
				block("tx", BlockTypes.db_transaction, { connection: DB_ID, executor: "p" }),
				block("p", TYPE),
				block("rb", BlockTypes.db_rollback, { message: "undo" }),
				block("ok", BlockTypes.response, { httpCode: "200" }),
				block("fail", BlockTypes.response, { httpCode: "400" }),
			],
			[
				edge("in", "tx"),
				edge("tx", "p", "executor"),
				edge("p", "rb"),
				edge("tx", "ok", "success"),
				edge("tx", "fail", "failure"),
			],
			{ projectId: PROJECT, blockMeta: { [TYPE]: META } },
		);
		const result = await request(run);
		expect(result.output).toEqual({ httpCode: "400", body: { reason: "rollback", message: "undo" } });
		expect(await rows()).not.toContain(note);
	}, 30_000);

	it("the same block outside a transaction keeps its write", async () => {
		const note = faker.string.alphanumeric(10);
		plugin(
			async ({ ctx }) => {
				const db = await ctx.integrations!.get<"database">(DB_ID);
				await db.raw(`INSERT INTO ${table} (note) VALUES ($1)`, [note]);
				return { output: 1 };
			},
			["database"],
		);
		await request(simple());
		expect(await rows()).toContain(note);
	}, 30_000);

	it("shares one pool across requests: no connection is opened for the next one", async () => {
		plugin(
			async ({ ctx }) => {
				const db = await ctx.integrations!.get<"database">(DB_ID);
				return { output: await db.raw("SELECT 1 AS one") };
			},
			["database"],
		);
		const graph = simple();
		const connections = async () =>
			Number(
				(
					await admin`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = 'testdb' AND pid <> pg_backend_pid()`
				)[0].n,
			);
		await request(graph);
		const afterFirst = await connections();
		const pools = manager.getStats();
		await request(graph);
		await request(graph);
		expect(await connections()).toBe(afterFirst);
		expect(manager.getStats()).toEqual(pools);
	}, 30_000);

	it("reaches a plugin variant of its own group through the registry, one client per poolKey", async () => {
		plugin(
			async ({ ctx }) => {
				const a = await ctx.integrations!.get<{ id: number }>(FAKE_ID);
				const b = await ctx.integrations!.get<{ id: number }>(FAKE_ID);
				return { output: { id: a.id, same: a === b } };
			},
			["acme/store/Fake"],
		);
		const graph = simple();
		const before = acmeCreated;
		expect((await request(graph)).output.body).toEqual({ id: before + 1, same: true });
		// the next request finds the pooled client, though no run held it in between
		expect((await request(graph)).output.body).toEqual({ id: before + 1, same: true });
		expect(acmeCreated).toBe(before + 1);
	}, 30_000);

	it("refuses a kind the block was not granted, and an id this project cannot use", async () => {
		plugin(async ({ ctx }) => ({ output: await ctx.integrations!.get<"kv">(KV_ID) }), ["database"]);
		const denied = await request(simple());
		expect(String(denied.error)).toContain("was not granted kv integrations");
		plugin(async ({ ctx }) => ({ output: await ctx.integrations!.get<"kv">("missing") }), ["kv"]);
		const unknown = await request(simple());
		expect(String(unknown.error)).toContain("integration 'missing' does not exist");
	}, 30_000);
});
