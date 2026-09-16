import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import type Docker from "dockerode";
import {
	DbFactory,
	KvFactory,
	DbType,
	type Connection,
} from "@fluxify/adapters";
// subpath import on purpose: the container helpers are test-only and are
// deliberately not re-exported from the package barrel
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { BlockTypes } from "./blockTypes";
import { compileGraph } from "./compiler";
import type { BlockDTOType, EdgeDTOSchemaType } from "./builderTypes";

/**
 * Graph-level integration test: a compiled graph talking to a real Redis and a
 * real MySQL at the same time.
 *
 * The unit specs (`builtin/tests/compilerKv.spec.ts`) prove what the compiler
 * emits by asserting against a mock adapter. They cannot prove that a TTL
 * actually expires a key, that a row survives a JSON round trip through the
 * store, or that `KvFactory` resolves a variant against a live server — every
 * one of those is a property of the real thing, so it needs the real thing.
 *
 * The business logic under test is a read-through cache, the reason most people
 * put Redis in front of a database: look in the cache, and only on a miss go to
 * MySQL and populate the cache for next time.
 */

const REDIS_IMAGE = "valkey/valkey:8-alpine";
const MYSQL_IMAGE = "mysql:8.0.36-bullseye";
const REDIS_CONTAINER = "fluxify-kv-graph-redis-test";
const MYSQL_CONTAINER = "fluxify-kv-graph-mysql-test";

const KV_ID = "kv-conn";
const DB_ID = "db-conn";

let redisContainer: Docker.Container | undefined;
let mysqlContainer: Docker.Container | undefined;
let dbFactory: DbFactory;
let kvFactory: KvFactory;
let table: string;
let redisPort: number;

async function removeIfPresent(name: string) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
}

beforeAll(async () => {
	await removeIfPresent(REDIS_CONTAINER);
	await removeIfPresent(MYSQL_CONTAINER);
	await pullImage(REDIS_IMAGE);
	await pullImage(MYSQL_IMAGE);

	const redis = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: REDIS_IMAGE,
			name: REDIS_CONTAINER,
			HostConfig: {
				PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] },
			},
		}),
	);
	redisContainer = redis.container;
	redisPort = redis.port;

	const mysql = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: MYSQL_IMAGE,
			name: MYSQL_CONTAINER,
			Env: ["MYSQL_ROOT_PASSWORD=12345", "MYSQL_DATABASE=testdb"],
			HostConfig: {
				PortBindings: { "3306/tcp": [{ HostPort: String(hostPort) }] },
			},
		}),
	);
	mysqlContainer = mysql.container;

	const connection: Connection = {
		dbType: DbType.MYSQL,
		host: "127.0.0.1",
		port: mysql.port,
		username: "root",
		password: "12345",
		database: "testdb",
	};

	dbFactory = new DbFactory({ [DB_ID]: connection });

	// MySQL accepts TCP well before it accepts queries. Polled through the same
	// factory the graph uses, so "ready" means the code under test can query —
	// not merely that some other client could connect.
	let ready = false;
	for (let attempt = 0; attempt < 90; attempt++) {
		try {
			await dbFactory.getDbAdapter(DB_ID).raw("SELECT 1");
			ready = true;
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	if (!ready) throw new Error("MySQL container did not become ready in time.");
	kvFactory = new KvFactory({
		[KV_ID]: {
			variant: "Redis",
			host: "127.0.0.1",
			port: redisPort,
			source: "credentials",
		},
	});

	// the graph reads this table through the real db blocks
	table = `products_${faker.string.alphanumeric(8).toLowerCase()}`;
	const adapter = dbFactory.getDbAdapter(DB_ID);
	await adapter.raw(
		`CREATE TABLE ${table} (
			id INT AUTO_INCREMENT PRIMARY KEY,
			sku VARCHAR(64) NOT NULL,
			name VARCHAR(255) NOT NULL,
			price INT NOT NULL
		)`,
	);
}, 180_000);

afterAll(async () => {
	await KvFactory.ResetConnections().catch(() => {});
	dbFactory?.dispose();
	await DbFactory.ResetConnections().catch(() => {});
	await removeIfPresent(REDIS_CONTAINER);
	await removeIfPresent(MYSQL_CONTAINER);
	redisContainer = undefined;
	mysqlContainer = undefined;
});

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
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

function context() {
	const vars: Record<string, any> = {};
	return {
		route: "/products/:sku",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		dbFactory,
		kvFactory,
		stopper: { timeoutEnd: 0, duration: 30_000 },
	} as any;
}

async function run(blocks: BlockDTOType[], edges: EdgeDTOSchemaType, input?: any) {
	const { run: compiled } = compileGraph(blocks, edges);
	return compiled(context(), input);
}

/** runs the cache graph for one key/sku, so each test reads as the flow it is */
async function runCache(key: string, sku: string, ttl?: number) {
	const { blocks, edges } = cacheGraph(key, sku, ttl);
	return run(blocks, edges);
}

/** what is actually sitting in Redis under a key, right now */
function cachedValue(key: string) {
	return kvFactory.getKvAdapter(KV_ID).get(key);
}

/** the read-through cache, as a user would wire it on the canvas */
function cacheGraph(key: string, sku: string, ttl?: number) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		block("lookup", BlockTypes.kv_operations, {
			connection: KV_ID,
			operation: "get",
			key,
			parseJson: true,
		}),
		// a cache miss reads null, which is what decides the branch.
		// `rhs` is required by the condition schema even for a unary operator.
		block("miss", BlockTypes.if, {
			conditions: [{ lhs: "js:return input", rhs: "", operator: "is_empty" }],
		}),
		block("fetch", BlockTypes.db_getsingle, {
			connection: DB_ID,
			tableName: table,
			conditions: [
				{
					attribute: { kind: "column", value: "sku" },
					operator: "eq",
					value: { kind: "literal", value: sku },
					chain: "and",
				},
			],
			columns: ["id", "sku", "name", "price"],
			joins: [],
		}),
		block("populate", BlockTypes.kv_operations, {
			connection: KV_ID,
			operation: "set",
			key,
			// store exactly what the database returned
			useParam: true,
			...(ttl === undefined ? {} : { ttl }),
		}),
		block("fromDb", BlockTypes.response, { httpCode: "200" }),
		block("fromCache", BlockTypes.response, { httpCode: "200" }),
	];
	const edges: EdgeDTOSchemaType = [
		edge("in", "lookup"),
		edge("lookup", "miss"),
		edge("miss", "fetch", "success"),
		edge("miss", "fromCache", "failure"),
		edge("fetch", "populate"),
		edge("populate", "fromDb"),
	];
	return { blocks, edges };
}

async function seedProduct(sku: string, name: string, price: number) {
	const adapter = dbFactory.getDbAdapter(DB_ID);
	await adapter.insert(table, { sku, name, price });
}

describe("read-through cache over real Redis and MySQL", () => {
	it("misses the cache, reads MySQL, then serves the same row from Redis", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;
		await seedProduct(sku, "Mechanical Keyboard", 4500);

		// 1st request: nothing cached, so the db branch runs and populates Redis
		const miss = await runCache(key, sku);
		expect(miss.successful).toBe(true);
		// `populate` returns true, so the body proves the set happened
		expect(miss.output.body).toBe(true);

		// the row really is in Redis now, as JSON
		const cached = await cachedValue(key);
		expect(cached).toBeString();
		expect(JSON.parse(cached!)).toMatchObject({
			sku,
			name: "Mechanical Keyboard",
			price: 4500,
		});

		// 2nd request: served from cache, parsed back into a real object
		const hit = await runCache(key, sku);
		expect(hit.successful).toBe(true);
		expect(hit.output.body).toMatchObject({
			sku,
			name: "Mechanical Keyboard",
			price: 4500,
		});
	});

	it("does not touch MySQL once the key is cached", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;
		await seedProduct(sku, "Desk Mat", 1200);

		await runCache(key, sku);

		// Deleting the row proves the second read never reaches the database: if
		// it did, the lookup would find nothing and the response would be null.
		await dbFactory.getDbAdapter(DB_ID).delete(table, [
			{
				attribute: { kind: "column", value: "sku" },
				operator: "eq",
				value: { kind: "literal", value: sku },
				chain: "and",
			},
		]);

		const hit = await runCache(key, sku);
		expect(hit.output.body).toMatchObject({ sku, name: "Desk Mat" });
	});

	it("expires a cached row after its TTL, falling back to MySQL", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;
		await seedProduct(sku, "Trackball", 6900);

		// 1 second, so the test can actually wait for it
		await runCache(key, sku, 1);
		expect(await cachedValue(key)).toBeString();

		await new Promise((resolve) => setTimeout(resolve, 1200));

		// the real store dropped the key, so the graph goes back to the db branch
		expect(await cachedValue(key)).toBeNull();
		const refetch = await runCache(key, sku, 1);
		expect(refetch.output.body).toBe(true);
		expect(JSON.parse((await cachedValue(key))!)).toMatchObject({
			name: "Trackball",
		});
	});

	it("keeps a key with no TTL, and invalidation sends the next read back to MySQL", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;
		await seedProduct(sku, "Monitor Arm", 8900);

		// no ttl field at all: the key must persist rather than expire immediately
		await runCache(key, sku);
		await new Promise((resolve) => setTimeout(resolve, 1200));
		expect(await cachedValue(key)).toBeString();

		// a price change invalidates the cache through the delete operation
		await dbFactory.getDbAdapter(DB_ID).update(
			table,
			{ price: 7900 },
			[
				{
					attribute: { kind: "column", value: "sku" },
					operator: "eq",
					value: { kind: "literal", value: sku },
					chain: "and",
				},
			],
		);
		const invalidate = await run(
			[
				block("in", BlockTypes.entrypoint),
				block("drop", BlockTypes.kv_operations, {
					connection: KV_ID,
					operation: "delete",
					key,
				}),
				block("out", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("in", "drop"), edge("drop", "out")],
		);
		expect(invalidate.output.body).toBe(true);
		expect(await cachedValue(key)).toBeNull();

		// next read re-populates from MySQL, with the new price
		await runCache(key, sku);
		expect(JSON.parse((await cachedValue(key))!)).toMatchObject({
			price: 7900,
		});
	});

	it("misses for a sku that is not in MySQL, and caches nothing useful", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;

		// no seed: the db branch runs and finds nothing
		const result = await runCache(key, sku);
		expect(result.successful).toBe(true);

		// a null row is stored as the JSON literal null, so the next read parses
		// back to null and is treated as a miss again rather than a phantom hit
		const cached = await cachedValue(key);
		expect(cached === null || cached === "null").toBe(true);
	});

	it("keeps separate keys separate", async () => {
		const first = faker.string.alphanumeric(10);
		const second = faker.string.alphanumeric(10);
		await seedProduct(first, "Cable", 300);
		await seedProduct(second, "Hub", 2500);

		await runCache(`product:${first}`, first);
		await runCache(`product:${second}`, second);

		expect(JSON.parse((await cachedValue(`product:${first}`))!)).toMatchObject({
			name: "Cable",
		});
		expect(JSON.parse((await cachedValue(`product:${second}`))!)).toMatchObject({
			name: "Hub",
		});
	});

	it("fails the graph when a cached value is not the JSON it was promised", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;
		// something else wrote plain text under this key
		await kvFactory.getKvAdapter(KV_ID).set(key, "not json at all");

		const result = await runCache(key, sku);

		expect(result.successful).toBe(false);
		// the house shape: `error` carries the Error itself, cause attached
		expect((result.error as any).message).toBe("failed to execute get kv block");
	});

	it("reuses one Redis client across requests, and reconnects after config changes", async () => {
		const sku = faker.string.alphanumeric(10);
		const key = `product:${sku}`;
		await seedProduct(sku, "Webcam", 5500);

		const before = kvFactory.getKvAdapter(KV_ID);
		await runCache(key, sku);
		// same integration id, same client — the factory must not open a second
		// connection per request
		expect(kvFactory.getKvAdapter(KV_ID)).toBe(before);

		// A changed fingerprint retires the old client. The port stays real so the
		// replacement can still talk to the container; only the credential moves.
		KvFactory.synchronize({
			[KV_ID]: {
				variant: "Redis",
				host: "127.0.0.1",
				port: redisPort,
				source: "credentials",
				password: "rotated",
			},
		});
		const after = kvFactory.getKvAdapter(KV_ID);
		expect(after).not.toBe(before);

		// and the surviving factory still serves reads on the original config
		KvFactory.synchronize({
			[KV_ID]: {
				variant: "Redis",
				host: "127.0.0.1",
				port: redisPort,
				source: "credentials",
			},
		});
		expect(await cachedValue(key)).toBeString();
	});
});
