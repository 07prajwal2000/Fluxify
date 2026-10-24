import { describe, expect, it } from "bun:test";
import { block, fluxifyManifestSchema, param, toManifestEntry } from "../blocks.js";
import {
	type DatabaseAdapter,
	type IntegrationVariantDef,
	integration,
	integrationEntrySchema,
	type KvAdapter,
	paramsConfigSchema,
	toIntegrationEntry,
} from "../integrations.js";
import { manifestVariantMeta, openVariant, SECRET_VALUES, toVariantDef } from "../runtime.js";
import { memoryKv, runIntegration } from "../testing.js";

const base = { label: "Hub", icon: "./hub.svg", variant: "Fake" };
const kvOf = (kv: KvAdapter, seen = { closes: 0 }) =>
	integration({
		...base,
		name: "acme/t/kv",
		group: "kv",
		variant: "Upstash",
		config: { url: param.string({ required: true }), token: param.secret({ required: true }) },
		connect: () => kv,
		close: () => void seen.closes++,
	});

describe("integration()", () => {
	it("puts a plugin's own group under its scope and writes the manifest entry", () => {
		const def = integration({
			...base,
			name: "acme/t/crm/hub",
			group: "crm",
			tabs: ["General", "Auth"],
			config: {
				region: param.select({ options: ["eu", "us"], default: "eu" }),
				token: param.secret({ label: "Token", tab: "Auth", required: true }),
			},
			connect: () => ({}),
			test: () => ({ success: true }),
		});
		expect(toIntegrationEntry(def)).toEqual({
			name: "acme/t/crm/hub",
			label: "Hub",
			icon: "./hub.svg",
			group: "acme/crm",
			variant: "Fake",
			configSchema: {
				region: { type: "select", options: ["eu", "us"], default: "eu", order: 0 },
				token: { type: "secret", label: "Token", tab: "Auth", required: true, order: 0 },
			},
			tabs: ["General", "Auth"],
			secretParams: ["token"],
			hasTest: true,
			hasDescribe: false,
			hasInspect: false,
		});
	});

	const bad = (extra: object) => () =>
		integration({ ...base, name: "acme/t/x", group: "crm", config: {}, connect: () => ({}), ...extra } as any);

	it("refuses a scoped group, a canvas-only param, app config and reserved names", () => {
		expect(bad({ group: "acme/crm" })).toThrow("the scope is added for you");
		expect(bad({ config: { q: param.js() } })).toThrow("cannot take a js param");
		expect(bad({ config: { k: param.appconfig() } })).toThrow("reads app config through param.secret()");
		expect(bad({ config: { variant: param.string() } })).toThrow("config name 'variant' is reserved");
		expect(bad({ config: { __x: param.string() } })).toThrow("config name '__x' is reserved");
	});

	it("checks visibleWhen and tabs against the config", () => {
		expect(bad({ config: { a: param.string({ visibleWhen: { b: "x" } }) } })).toThrow("names 'b'");
		expect(bad({ tabs: ["Auth"], config: { a: param.string() } })).toThrow("tabs lists 'Auth'");
	});

	it("a block cannot take a secret param", () => {
		expect(() =>
			block({ name: "acme/t/b", label: "B", params: { s: param.secret() }, run: () => {} }),
		).toThrow("a secret belongs to an integration's config");
	});
});

describe("manifest lint rules", () => {
	const entry = (over: object) => ({ ...toIntegrationEntry(kvOf(memoryKv())), ...over });

	it("a variant of a built-in group may not take a built-in name or dbType", () => {
		const issue = (over: object) =>
			integrationEntrySchema.safeParse(entry(over)).error?.issues.map((i) => i.message);
		expect(issue({ variant: "redis" })).toEqual(["variant 'redis' is taken by a built-in kv variant"]);
		expect(issue({ group: "database", variant: "Acme", extras: { conditionEditor: "sql", dbType: "PG" } })).toEqual([
			"extras.dbType 'PG' is taken by a built-in database",
		]);
		expect(issue({ group: "database", variant: "Acme" })).toEqual([
			"a database variant needs extras.dbType",
			"a database variant needs extras.conditionEditor: 'sql' or 'js'",
		]);
	});

	it("a local group may not shadow a built-in group, nor sit in another scope", () => {
		const issue = (group: string) => integrationEntrySchema.safeParse(entry({ group })).error?.issues[0]?.message;
		expect(issue("acme/kv")).toContain("shadows the built-in group");
		expect(issue("acme/KV")).toContain("shadows the built-in group 'kv'");
		expect(issue("acme/Crm")).toBe("group 'Crm' must be lowercase letters, digits and -");
		expect(issue("other/crm")).toBe("group 'other/crm' must be a built-in group or 'acme/<group>'");
		expect(issue("acme/crm")).toBeUndefined();
	});

	it("one plugin declares a group/variant once, each at its fixed entry", () => {
		const manifest = (list: object[]) =>
			fluxifyManifestSchema.safeParse({
				name: "acme/t",
				url: "https://x.dev",
				sdk: ">=2026.10.2001",
				blocks: {},
				integrations: list,
			});
		const a = { ...entry({}), entry: "dist/integrations/kv.js" };
		expect(manifest([a]).success).toBe(true);
		const dup = { ...a, name: "acme/t/kv2", entry: "dist/integrations/kv2.js", variant: "UPSTASH" };
		expect(manifest([a, dup]).error?.issues[0]?.message).toBe(
			"variant 'kv/UPSTASH' is declared twice in this plugin",
		);
		expect(manifest([{ ...a, entry: "dist/x.js" }]).error?.issues[0]?.message).toBe(
			"must be 'dist/integrations/kv.js'",
		);
		// manifests from before integrations stay valid
		expect(manifest([]).success).toBe(true);
	});

	it("a block may be granted built-in kinds and this plugin's own groups only (#899)", () => {
		const crm = { ...entry({ name: "acme/t/hub", group: "acme/crm", variant: "Hub" }), entry: "dist/integrations/hub.js" };
		const asking = (integrations: string[]) => {
			const b = block({
				name: "acme/t/use",
				label: "Use",
				permissions: { integrations },
				async run() {
					return { output: null };
				},
			});
			return fluxifyManifestSchema.safeParse({
				name: "acme/t",
				url: "https://x.dev",
				sdk: ">=2026.10.2001",
				blocks: { "acme/t/use": { ...toManifestEntry(b), entry: "dist/blocks/use.js" } },
				integrations: [crm],
			}).error?.issues.map((i) => i.message);
		};
		expect(asking(["kv", "database/PostgreSQL", "acme/crm", "acme/crm/Hub"])).toBeUndefined();
		expect(asking(["other/crm"])?.[0]).toContain("is not one of this plugin's own integration groups (acme/crm)");
		expect(asking(["acme/billing"])?.[0]).toContain("not one of this plugin's own");
		// not a kind at all: refused by block() itself
		expect(() => asking(["slack"])).toThrow("'slack' is not an integration kind");
	});
});

describe("paramsConfigSchema", () => {
	const schema = paramsConfigSchema({
		region: param.string({ required: true }),
		token: param.secret({ required: true }),
		size: param.number(),
	});

	it("takes a secret as a cfg: reference only, and checks the rest like block params", () => {
		expect(schema.safeParse({ region: "eu", token: "cfg:TOKEN" }).success).toBe(true);
		const messages = (v: object) => schema.safeParse(v).error?.issues.map((i) => i.message);
		expect(messages({ region: "eu", token: "plain-text" })).toEqual([
			"must be an app config key reference, cfg:<KEY>",
		]);
		expect(messages({ token: "cfg:T" })).toEqual(["param 'region' is required"]);
		expect(messages({ region: "eu", token: "cfg:T", size: "3" })).toEqual([
			"param 'size' must be a number, got string",
		]);
	});

	it("checks a number config's bounds and integerness", () => {
		const bounded = paramsConfigSchema({
			port: param.number({ required: true, min: 1, max: 65_535, integer: true }),
		});
		const messages = (v: object) => bounded.safeParse(v).error?.issues.map((i) => i.message);
		expect(bounded.safeParse({ port: 5432 }).success).toBe(true);
		expect(messages({ port: 0 })).toEqual(["param 'port' must be at least 1, got 0"]);
		expect(messages({ port: 65_536 })).toEqual(["param 'port' must be at most 65535, got 65536"]);
		expect(messages({ port: 5432.5 })).toEqual(["param 'port' must be an integer"]);
	});
});

describe("toVariantDef", () => {
	it("resolve keeps each secret as its key and carries only those keys' values", () => {
		const v = toVariantDef(kvOf(memoryKv()));
		expect(v.resolve!({ url: "u", token: "cfg:T" }, { T: "secret", OTHER: "x" })).toEqual({
			url: "u",
			token: "T",
			[SECRET_VALUES]: { T: "secret" },
		});
	});

	it("kv: create hands the factory a client at once, which waits for connect; disconnect closes once", async () => {
		const kv = memoryKv();
		const seen = { closes: 0 };
		const v = toVariantDef(kvOf(kv, seen)) as IntegrationVariantDef<"kv">;
		const client = v.create!(v.resolve!({ url: "u", token: "cfg:T" }, { T: "s" }), {});
		await client.set("a", "1");
		expect([await client.get("a"), await kv.get("a")]).toEqual(["1", "1"]);
		await client.disconnect();
		await client.disconnect();
		expect(seen.closes).toBe(1);
	});

	it("database: connect opens the pool once, each create is its own adapter on it, the pool closes it", async () => {
		let closes = 0;
		let connects = 0;
		/** one adapter per request, holding its own transaction state */
		const adapterOn = (pool: { name: string }) => {
			let inTx = false;
			return {
				getSingle: async () => ({ pool: pool.name, inTx }),
				startTransaction: async () => void (inTx = true),
			} as unknown as DatabaseAdapter;
		};
		const def = integration({
			...base,
			name: "acme/t/db",
			group: "database",
			extras: { conditionEditor: "sql", dbType: "acme" },
			config: {},
			connect: () => ({ name: `pool${++connects}` }),
			adapter: adapterOn,
			close: () => void closes++,
		});
		const v = toVariantDef(def) as IntegrationVariantDef<"database">;
		expect(v.extras).toEqual({ conditionEditor: "sql", dbType: "acme" });
		const config = v.resolve!({}, {});
		const pool = v.connect(config);
		const [a, b] = [v.create(config, { pool }), v.create(config, { pool })];
		await a.startTransaction();
		expect(await a.getSingle("t", [])).toEqual({ pool: "pool1", inTx: true });
		expect(await b.getSingle("t", [])).toEqual({ pool: "pool1", inTx: false });
		// only the contract's methods: an optional one the adapter lacks reads as missing
		expect((a as { introspect?: unknown }).introspect).toBeUndefined();
		expect((a as { then?: unknown }).then).toBeUndefined();
		await pool.close();
		await pool.close();
		expect([connects, closes]).toEqual([1, 1]);
		const { client, close } = await openVariant(v, config);
		expect(await (client as DatabaseAdapter).getSingle("t", [])).toEqual({ pool: "pool2", inTx: false });
		await close();
	});

	it("database: integration() refuses one without adapter()", () => {
		expect(() =>
			integration({
				...base,
				name: "acme/t/db",
				group: "database",
				extras: { conditionEditor: "sql", dbType: "acme" },
				config: {},
				connect: () => ({}),
			} as never),
		).toThrow("a database integration needs adapter(pool, config)");
	});

	it("manifestVariantMeta: validates and resolves from the manifest alone, with no code", () => {
		const entry = { ...toIntegrationEntry(kvOf(memoryKv())), entry: "dist/integrations/kv.js" };
		const meta = manifestVariantMeta(entry, "acme/t");
		expect([meta.group, meta.variant, meta.plugin]).toEqual(["kv", entry.variant, "acme/t"]);
		expect(meta.create).toBeUndefined();
		expect(meta.test).toBeUndefined();
		expect(meta.configSchema.safeParse({ url: "u", token: "cfg:T" }).success).toBe(true);
		expect(meta.configSchema.safeParse({ url: "u", token: "T" }).success).toBe(false);
		// the same resolved shape the worker's own def produces
		expect(meta.resolve!({ url: "u", token: "cfg:T" }, { T: "s", OTHER: "x" })).toEqual(
			toVariantDef(kvOf(memoryKv())).resolve!({ url: "u", token: "cfg:T" }, { T: "s", OTHER: "x" }),
		);
	});

	it("a Test connection that throws fails with the message; no test hook means none offered", async () => {
		const def = integration({
			...base,
			name: "acme/t/x",
			group: "crm",
			config: {},
			connect: () => ({}),
			test: () => {
				throw new Error("401 from the API");
			},
		});
		expect(await runIntegration(def, { config: {} }).test()).toEqual({ success: false, error: "401 from the API" });
		expect(toVariantDef({ ...def, test: undefined }).test).toBeUndefined();
	});

	it("runIntegration refuses an invalid config as the admin would", () => {
		expect(() => runIntegration(kvOf(memoryKv()), { config: { token: "T" } })).toThrow(
			"Invalid configuration: param 'url' is required",
		);
	});
});
