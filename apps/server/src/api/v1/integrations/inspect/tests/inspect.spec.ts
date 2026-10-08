import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as real from "@fluxify/adapters";

const P = "019a0000-0000-7000-8000-000000000000";
const I = "019a0000-0000-7000-8000-000000000001";

let row: any;
let roles: string[] = [];
const describeConnection = mock(async () => ({ tables: ["users"] }) as any);
const redis = { get: mock(async () => null as string | null), ttl: mock(async () => -2) };
let memValue: string | null = null;

mock.module("../../get-by-id/repository", () => ({ getIntegrationByID: async () => row }));
mock.module("../../test-connection/service", () => ({ decodeAppConfig: async () => new Map() }));
mock.module("../../../../auth/middleware", () => ({
	requireProjectAccess: (role: string) => {
		roles.push(role);
		return async (_c: any, next: any) => next();
	},
}));
mock.module("@fluxify/adapters", () => ({
	...real,
	describeConnection,
	RedisIntegration: class {
		static ExtractConnectionInfo = (c: any) => c;
		getConnection = () => redis;
		disconnect = async () => {};
	},
	MemcachedIntegration: class {
		static ExtractConnectionInfo = (c: any) => c;
		get = async () => memValue;
		disconnect = async () => {};
	},
}));

const { getKvValue, getSchemaDetails, KV_VALUE_CAP } = await import("../service");
const { Hono } = await import("hono");
const registerInspectRoutes = (await import("../route")).default;

const params = { projectId: P, integrationId: I };
const pg = { group: "database", variant: "PostgreSQL", config: { source: "credentials", host: "h", port: "5432", username: "u", password: "p", database: "d", ssl: "false" } };

beforeEach(() => {
	describeConnection.mockClear();
});

describe("integration schema details", () => {
	it("names only without tables, detail for the comma separated list", async () => {
		row = pg;
		expect(await getSchemaDetails(params)).toEqual({ tables: ["users"] } as any);
		expect((describeConnection.mock.calls[0] as any[])[1]).toBeUndefined();
		await getSchemaDetails(params, " users , orders,");
		expect((describeConnection.mock.calls[1] as any[])[1]).toEqual(["users", "orders"]);
	});

	it("non-database groups get a clear 400", async () => {
		row = { group: "ai", variant: "OpenAI", config: {} };
		await expect(getSchemaDetails(params)).rejects.toThrow("Not supported for ai integrations");
	});

	it("driver errors read as 'Failed to read schema: ...'", async () => {
		row = pg;
		describeConnection.mockImplementationOnce(async () => {
			throw new Error('Unknown table "nope"');
		});
		await expect(getSchemaDetails(params, "nope")).rejects.toThrow('Failed to read schema: Unknown table "nope"');
	});

	it("both routes need the creator role", async () => {
		roles = [];
		const app = new Hono();
		registerInspectRoutes(app as any);
		expect(roles).toEqual(["creator", "creator"]);
	});
});

describe("kv get", () => {
	it("redis: value and TTL; no expiry is null", async () => {
		row = { group: "kv", variant: "Redis", config: {} };
		redis.get.mockImplementationOnce(async () => "v");
		redis.ttl.mockImplementationOnce(async () => 42);
		expect(await getKvValue(params, "k")).toEqual({ key: "k", found: true, value: "v", truncated: false, ttlSeconds: 42 });
		redis.get.mockImplementationOnce(async () => "v");
		redis.ttl.mockImplementationOnce(async () => -1);
		expect((await getKvValue(params, "k")).ttlSeconds).toBeNull();
	});

	it("caps long values and says so", async () => {
		row = { group: "kv", variant: "Redis", config: {} };
		redis.get.mockImplementationOnce(async () => "x".repeat(KV_VALUE_CAP + 5));
		const r = await getKvValue(params, "k");
		expect(r.value!.length).toBe(KV_VALUE_CAP);
		expect(r.truncated).toBe(true);
	});

	it("memcached: value only, TTL unknown; missing key is found: false", async () => {
		row = { group: "kv", variant: "Memcached", config: {} };
		memValue = "m";
		expect(await getKvValue(params, "k")).toMatchObject({ found: true, value: "m", ttlSeconds: null, ttlNote: expect.stringContaining("unknown") });
		memValue = null;
		expect(await getKvValue(params, "k")).toMatchObject({ found: false, value: null });
	});

	it("non-kv groups get a clear 400", async () => {
		row = pg;
		await expect(getKvValue(params, "k")).rejects.toThrow("Not supported for database integrations");
	});
});
