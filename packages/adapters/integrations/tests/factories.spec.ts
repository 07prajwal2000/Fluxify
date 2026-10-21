import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Connection, IntegrationVariantDef, QueueConnector } from "@fluxify/sdk/integrations";
import z from "zod";
import { integrationRegistry } from "..";
import { DbConnectionManager, DbFactory, MongoAdapter, MySqlAdapter, PostgresAdapter } from "../../db";
import { KvFactory } from "../../kv/factory";
import { MemcachedIntegration } from "../../kv/memcached";
import { RedisIntegration } from "../../kv/redis";
import { createObservabilityLogger, LokiLogger, OpenTelemetryLogs } from "../../observability";
import { QueueProducerFactory } from "../../queue/producers";

/**
 * The factories resolve every adapter through the registry: the built-ins give
 * the same classes they always did, and a variant registered here — the path a
 * plugin takes in I6 — is created by the same unchanged factories.
 */

const registered: [string, string, string | undefined][] = [];
function register(def: IntegrationVariantDef, projectId?: string) {
	integrationRegistry.register(def, projectId);
	registered.push([def.group, def.variant, projectId]);
}

afterEach(async () => {
	for (const [group, variant, projectId] of registered.splice(0))
		integrationRegistry.unregister(group, variant, projectId);
	await KvFactory.ResetConnections();
});

const db = (dbType: string): Connection =>
	({ dbType, host: "127.0.0.1", port: 1, username: "u", password: "p", database: "d" }) as Connection;

describe("built-in variants keep their adapter classes", () => {
	it("DbFactory", async () => {
		// clients are lazy: nothing connects until a query runs
		const manager = new DbConnectionManager();
		const factory = new DbFactory({ pg: db("pg"), my: db("mysql"), mo: db("MONGO") }, manager);
		try {
			expect(factory.getDbAdapter("pg")).toBeInstanceOf(PostgresAdapter);
			expect(factory.getDbAdapter("my")).toBeInstanceOf(MySqlAdapter);
			expect(factory.getDbAdapter("mo")).toBeInstanceOf(MongoAdapter);
		} finally {
			factory.dispose();
			await manager.close();
		}
	});

	it("DbFactory refuses an unknown dbType without leasing a pool", () => {
		const create = mock(() => ({ db: {}, close: async () => {} }));
		const factory = new DbFactory({ x: db("oracle") }, new DbConnectionManager(create));
		expect(() => factory.getDbAdapter("x")).toThrow('Unknown integration variant "oracle"');
		expect(create).not.toHaveBeenCalled();
	});

	it("KvFactory", () => {
		const factory = new KvFactory({
			mem: { variant: "Memcached", host: "127.0.0.1", port: 1, source: "credentials" },
			red: { variant: "Redis", source: "url", url: "redis://127.0.0.1:1" },
		});
		expect(factory.getKvAdapter("mem")).toBeInstanceOf(MemcachedIntegration);
		expect(factory.getKvAdapter("red")).toBeInstanceOf(RedisIntegration);
	});

	it("observability, by name and by the old alias", () => {
		const settings = { baseUrl: "https://o.example.com", credentials: "x" };
		expect(createObservabilityLogger("Loki", settings)).toBeInstanceOf(LokiLogger);
		expect(createObservabilityLogger("Open Telemetry", settings)).toBeInstanceOf(OpenTelemetryLogs);
		expect(createObservabilityLogger("Open Telemetry Logs", settings)).toBeInstanceOf(OpenTelemetryLogs);
		expect(() => createObservabilityLogger("Splunk", settings)).toThrow('"Splunk"');
	});

	it("queue producers load the same connector per variant", async () => {
		const producer = { close: async () => {} };
		const load = mock(async (_type: string) => ({ createProducer: () => producer }) as unknown as QueueConnector);
		const factory = new QueueProducerFactory(
			{ k: { variant: "Kafka" }, n: { variant: "NATS" }, s: { variant: "SQS" }, r: { variant: "RabbitMQ" } },
			{ redis: { variant: "Redis" } },
			() => true,
			load,
		);
		for (const id of ["k", "n", "s", "r", "redis"]) expect(await factory.getProducer(id)).toBe(producer as never);
		expect(load.mock.calls.map(([type]) => type)).toEqual(["kafka", "nats", "sqs", "rabbitmq", "redis"]);
		expect(() =>
			new QueueProducerFactory({ x: { variant: "Pulsar" } }, {}, () => true, load).getProducer("x"),
		).toThrow("Pulsar cannot send messages");
		await QueueProducerFactory.closeAll();
	});
});

describe("a registered variant goes through the real factories", () => {
	const configSchema = z.object({});

	it("DbFactory leases its pool and creates its adapter", async () => {
		const adapter = { kind: "acme" };
		const close = mock(async () => {});
		register({
			group: "database",
			variant: "AcmeDB",
			label: "AcmeDB",
			configSchema,
			extras: { conditionEditor: "js", dbType: "acme" },
			connect: (config) => ({ db: { host: config.host }, close }),
			create: (_config, { pool }) => ({ ...adapter, pool }) as never,
		});
		const manager = new DbConnectionManager();
		const factory = new DbFactory({ a: db("acme") }, manager);
		const created = factory.getDbAdapter("a") as never as { kind: string; pool: { db: unknown } };
		expect(created.kind).toBe("acme");
		expect(created.pool.db).toEqual({ host: "127.0.0.1" });
		// one adapter per request, one pool per integration
		expect(factory.getDbAdapter("a")).toBe(created as never);
		factory.dispose();
		await manager.close();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("KvFactory caches its client and closes it on reset", async () => {
		const disconnect = mock(async () => {});
		const client = { get: async () => "v", set: async () => {}, setex: async () => {}, delete: async () => {}, disconnect };
		register({ group: "kv", variant: "AcmeKV", label: "AcmeKV", configSchema, create: () => client });
		const factory = new KvFactory({ c: { variant: "AcmeKV", source: "credentials", host: "h" } });
		expect(factory.getKvAdapter("c")).toBe(client as never);
		expect(factory.getKvAdapter("c")).toBe(client as never);
		await KvFactory.ResetConnections();
		expect(disconnect).toHaveBeenCalledTimes(1);
	});
});

describe("a plugin variant's own poolKey decides when a client is replaced (I6)", () => {
	const configSchema = z.object({});
	const P = "proj-poolkey";

	it("KvFactory: a change in the poolKey replaces the client, a change outside it keeps it", async () => {
		const disconnects: string[] = [];
		const made: string[] = [];
		register(
			{
				group: "kv",
				variant: "Upstash",
				label: "Upstash",
				configSchema,
				poolKey: (config: any) => config.url,
				create: (config: any) => {
					made.push(config.url);
					return {
						get: async () => config.url,
						set: async () => {},
						setex: async () => {},
						delete: async () => {},
						disconnect: async () => void disconnects.push(config.url),
					};
				},
			} as never,
			P,
		);
		const config = (url: string, label = "a") =>
			({ variant: "Upstash", url, label, __projectId: P }) as never;
		const first = new KvFactory({ c: config("redis://one") }).getKvAdapter("c");
		// not in the poolKey: the same client
		expect(new KvFactory({ c: config("redis://one", "b") }).getKvAdapter("c")).toBe(first);
		// the built-in fingerprint never reads `url` for a plugin field like this; the poolKey does
		KvFactory.synchronize({ c: config("redis://two") });
		await Bun.sleep(0);
		expect(disconnects).toEqual(["redis://one"]);
		expect(await new KvFactory({ c: config("redis://two") }).getKvAdapter("c").get("k")).toBe("redis://two");
		expect(made).toEqual(["redis://one", "redis://two"]);
	});

	it("DbConnectionManager: a change in the poolKey swaps the pool", async () => {
		const closed: string[] = [];
		register(
			{
				group: "database",
				variant: "AcmeDB",
				label: "AcmeDB",
				configSchema,
				extras: { conditionEditor: "sql", dbType: "acmedb" },
				poolKey: (config: any) => config.dsn,
				connect: (config: any) => ({ db: config.dsn, close: async () => void closed.push(config.dsn) }),
				create: (_c: unknown, { pool }: any) => ({ pool: pool.db }) as never,
			} as never,
			P,
		);
		const config = (dsn: string) => ({ dbType: "acmedb", dsn, __projectId: P }) as never;
		const manager = new DbConnectionManager();
		const before = new DbFactory({ a: config("one") }, manager);
		expect((before.getDbAdapter("a") as never as { pool: string }).pool).toBe("one");
		before.dispose();
		manager.synchronize({ a: config("two") });
		const after = new DbFactory({ a: config("two") }, manager);
		expect((after.getDbAdapter("a") as never as { pool: string }).pool).toBe("two");
		after.dispose();
		await manager.close();
		expect(closed.sort()).toEqual(["one", "two"]);
	});

	it("a project's plugin variant is invisible to every other project", () => {
		register({ group: "kv", variant: "Scoped", label: "Scoped", configSchema, create: () => ({}) } as never, P);
		expect(() => new KvFactory({ c: { variant: "Scoped", __projectId: "other" } as never }).getKvAdapter("c")).toThrow(
			"Scoped",
		);
	});
});
