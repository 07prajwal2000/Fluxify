import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { DbConnectionManager, DbFactory, integrationRegistry, PostgresAdapter } from "@fluxify/adapters";
// subpath import on purpose: the container helpers are test-only
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { param } from "@fluxify/sdk/blocks";
import { integration } from "@fluxify/sdk/integrations";
import { toVariantDef } from "@fluxify/sdk/runtime";
import { SQL } from "bun";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType } from "./builderTypes";
import { registerModuleBlock, unregisterBlock } from "./builtin/customBlock";
import { compileGraph } from "./compiler";

/**
 * A plugin's database variant (I6) inside the built-in transaction blocks,
 * against a real Postgres. The plugin wraps the driver the way an author would:
 * `connect` opens one pool, `adapter` builds each request's adapter on it. Two
 * requests run their transactions at the same time; one rolls back, one
 * commits, and neither sees the other's rows. With one adapter shared across
 * requests (I5's limit) the second `startTransaction` would land on the first's.
 */

const PG_IMAGE = "postgres:bullseye";
const PG_CONTAINER = "fluxify-plugin-db-variant-pg-test";
const PROJECT = "proj-plugin-db-variant";
const DB_ID = "acme-db";
const SLEEP = "acme/db/sleep";

let admin: SQL;
let port = 0;
let table: string;
let connects = 0;

const acmePostgres = integration({
	name: "acme/db/pg",
	label: "Acme Postgres",
	icon: "./pg.svg",
	group: "database",
	variant: "AcmePostgres",
	extras: { conditionEditor: "sql", dbType: "acmepg" },
	config: {
		host: param.string({ required: true }),
		port: param.number({ required: true }),
		database: param.string({ required: true }),
		username: param.string({ required: true }),
		password: param.secret({ required: true }),
	},
	connect(config, ctx) {
		connects++;
		const sql = new SQL({
			adapter: "postgres",
			hostname: config.host,
			port: config.port,
			username: config.username,
			password: ctx.getConfig(config.password),
			database: config.database,
			max: 4,
		});
		return { sql, db: PostgresAdapter.createKysely(sql) };
	},
	adapter: (pool) => new PostgresAdapter(pool.db, pool.sql),
	close: (pool) => pool.db.destroy(),
});

const variant = toVariantDef(acmePostgres, { plugin: "acme/db" });
/** the resolved config the compiler publishes, with what the loader adds to every row */
const resolved = () => ({
	...variant.resolve!(
		{ host: "127.0.0.1", port, database: "testdb", username: "postgres", password: "cfg:PG_PASSWORD" },
		{ PG_PASSWORD: "12345" },
	),
	group: "database",
	variant: "AcmePostgres",
	dbType: "acmepg",
	__projectId: PROJECT,
});

beforeAll(async () => {
	await docker
		.getContainer(PG_CONTAINER)
		.remove({ force: true })
		.catch(() => {});
	await pullImage(PG_IMAGE);
	const pg = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG_IMAGE,
			name: PG_CONTAINER,
			Env: ["POSTGRES_USER=postgres", "POSTGRES_PASSWORD=12345", "POSTGRES_DB=testdb"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
		}),
	);
	port = pg.port;
	admin = new SQL(`postgres://postgres:12345@127.0.0.1:${port}/testdb`, { max: 1 });
	for (let attempt = 0; ; attempt++) {
		try {
			await admin`SELECT 1`;
			break;
		} catch (error) {
			if (attempt >= 90) throw error;
			await Bun.sleep(500);
		}
	}
	table = `orders_${faker.string.alphanumeric(8).toLowerCase()}`;
	await admin.unsafe(`CREATE TABLE ${table} (id SERIAL PRIMARY KEY, note TEXT NOT NULL)`);
	integrationRegistry.register(variant, PROJECT);
	// holds a transaction open, so the two requests overlap inside theirs
	registerModuleBlock(
		PROJECT,
		SLEEP,
		async () => {
			await Bun.sleep(300);
			return { output: null };
		},
		{ handles: { in: ["target"], out: ["source"], body: [] } } as never,
	);
}, 180_000);

afterAll(async () => {
	unregisterBlock(PROJECT, SLEEP);
	integrationRegistry.unregister("database", "AcmePostgres", PROJECT);
	await admin?.close().catch(() => {});
	await docker
		.getContainer(PG_CONTAINER)
		.remove({ force: true })
		.catch(() => {});
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

/** a transaction that inserts `note`, waits, and then commits or rolls back */
function transaction(note: string, rollback: boolean) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		block("tx", BlockTypes.db_transaction, { connection: DB_ID, executor: "insert" }),
		block("insert", BlockTypes.db_insert, {
			connection: DB_ID,
			tableName: table,
			useParam: false,
			data: { source: "raw", value: { note } },
		}),
		block("wait", SLEEP),
		...(rollback ? [block("rb", BlockTypes.db_rollback, { message: "undo" })] : []),
		block("ok", BlockTypes.response, { httpCode: "200" }),
		block("fail", BlockTypes.response, { httpCode: "400" }),
	];
	const edges = [
		edge("in", "tx"),
		edge("tx", "insert", "executor"),
		edge("insert", "wait"),
		...(rollback ? [edge("wait", "rb")] : []),
		edge("tx", "ok", "success"),
		edge("tx", "fail", "failure"),
	];
	return compileGraph(blocks, edges, {
		projectId: PROJECT,
		blockMeta: { [SLEEP]: { handles: { in: ["target"], out: ["source"], body: [] } } as never },
	}).run;
}

const manager = new DbConnectionManager();

/** one request: its own DbFactory over the shared pool, as the worker gives each request */
async function request(graph: ReturnType<typeof transaction>) {
	const dbFactory = new DbFactory({ [DB_ID]: resolved() as never }, manager);
	try {
		const ctx = {
			route: "/x",
			apiId: "a",
			projectId: PROJECT,
			vars: {},
			dbFactory,
			stopper: { timeoutEnd: 0, duration: 30_000 },
		} as never;
		return await graph(ctx, {});
	} finally {
		dbFactory.dispose();
	}
}

const notes = async () =>
	(await admin.unsafe(`SELECT note FROM ${table} ORDER BY id`)).map((r: { note: string }) => r.note);

describe("a plugin database variant in the built-in transaction blocks", () => {
	it("two concurrent requests: one rolls back, one commits, nothing leaks between them", async () => {
		const kept = `kept-${faker.string.alphanumeric(6)}`;
		const undone = `undone-${faker.string.alphanumeric(6)}`;
		const [rolledBack, committed] = await Promise.all([
			request(transaction(undone, true)),
			request(transaction(kept, false)),
		]);
		expect(rolledBack.output).toEqual({ httpCode: "400", body: { reason: "rollback", message: "undo" } });
		expect(committed.output.httpCode).toBe("200");
		const after = await notes();
		expect(after).toContain(kept);
		expect(after).not.toContain(undone);
	}, 60_000);

	it("shares one pool across requests: connect ran once for the integration", async () => {
		const before = connects;
		await request(transaction(`again-${faker.string.alphanumeric(6)}`, false));
		await request(transaction(`more-${faker.string.alphanumeric(6)}`, false));
		expect(connects).toBe(before);
		await manager.close();
		expect(connects).toBeGreaterThanOrEqual(1);
	}, 60_000);
});
