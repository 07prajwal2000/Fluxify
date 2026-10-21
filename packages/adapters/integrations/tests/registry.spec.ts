import { describe, expect, it } from "bun:test";
import {
	BUILT_IN_DB_TYPES,
	BUILT_IN_INTEGRATION_GROUPS,
	BUILT_IN_VARIANT_NAMES,
	type IntegrationVariantDef,
	isIntegrationGroupName,
	UnknownIntegrationVariantError,
} from "@fluxify/sdk/integrations";
import z from "zod";
// enter through the package index: builtins -> db adapters -> db/index -> integrations/index loops back
// to builtins, so loading builtins first reads BUILT_IN_VARIANTS before it exists
import "../index";
import { BUILT_IN_VARIANTS } from "../builtins";
import { IntegrationRegistry } from "../registry";

const fresh = () => new IntegrationRegistry(BUILT_IN_VARIANTS);
const configSchema = z.object({ token: z.string().min(1) });

const kvVariant = (variant: string, extra: Partial<IntegrationVariantDef> = {}) =>
	({ group: "kv", variant, label: variant, configSchema, ...extra }) as IntegrationVariantDef;

describe("IntegrationRegistry", () => {
	it("registers, looks up and unregisters a plugin variant", () => {
		const registry = fresh();
		registry.register(kvVariant("Acme KV", { tags: ["kv"] }));
		expect(registry.get("kv", "Acme KV")?.label).toBe("Acme KV");
		expect(registry.variants("kv").map((def) => def.variant)).toEqual(["Redis", "Memcached", "Acme KV"]);
		expect(registry.tags("kv", "Acme KV")).toEqual(["kv"]);
		expect(registry.isBuiltIn("kv", "Acme KV")).toBe(false);

		expect(registry.unregister("kv", "Acme KV")).toBe(true);
		expect(registry.get("kv", "Acme KV")).toBeUndefined();
		expect(registry.unregister("kv", "Acme KV")).toBe(false);
	});

	it("refuses a duplicate group/variant", () => {
		const registry = fresh();
		registry.register(kvVariant("Acme KV"));
		expect(() => registry.register(kvVariant("Acme KV"))).toThrow('"kv/Acme KV" is already registered');
		// the same name in another group is a different variant
		registry.register({ ...kvVariant("Acme KV"), group: "ai" } as IntegrationVariantDef);
	});

	it("never lets a plugin take a built-in's name or alias", () => {
		const registry = fresh();
		expect(() => registry.register(kvVariant("Redis"))).toThrow("already registered");
		expect(() =>
			registry.register({ ...kvVariant("Otel"), group: "observability", aliases: ["Open Telemetry Logs"] } as IntegrationVariantDef),
		).toThrow('"observability/Open Telemetry Logs" is already registered');
		expect(() =>
			registry.register({
				group: "database",
				variant: "Postgres Fork",
				label: "Postgres Fork",
				configSchema,
				extras: { conditionEditor: "sql", dbType: "PG" },
				connect: () => ({ db: {}, close: async () => {} }),
				create: () => ({}) as never,
			}),
		).toThrow('reuses dbType "PG" of "PostgreSQL"');
	});

	it("never unregisters a built-in, by name or alias", () => {
		const registry = fresh();
		expect(() => registry.unregister("database", "PostgreSQL")).toThrow("cannot be unregistered");
		expect(() => registry.unregister("observability", "Open Telemetry Logs")).toThrow("cannot be unregistered");
		expect(registry.get("database", "PostgreSQL")).toBeDefined();
	});

	it("accepts a namespaced group and lists it after the built-ins", () => {
		const registry = fresh();
		expect(registry.hasGroup("acme/crm")).toBe(false);
		registry.register({ ...kvVariant("Acme CRM"), group: "acme/crm" } as IntegrationVariantDef);
		expect(registry.hasGroup("acme/crm")).toBe(true);
		expect(registry.groups()).toEqual([
			"database",
			"kv",
			"ai",
			"baas",
			"observability",
			"queue",
			"mcp",
			"acme/crm",
		]);
		registry.unregister("acme/crm", "Acme CRM");
		expect(registry.groups()).not.toContain("acme/crm");
	});

	it("refuses a bare new group and a namespace that shadows a built-in group", () => {
		const registry = fresh();
		for (const group of ["acme", "database/acme", "DATABASE/x", "kv/cache", "acme/", "/crm", "Acme/crm"]) {
			expect(isIntegrationGroupName(group)).toBe(false);
			expect(() => registry.register({ ...kvVariant("X"), group } as IntegrationVariantDef)).toThrow(
				"must be a built-in group",
			);
		}
	});

	it("names the unknown variant or group instead of a zod enum message", () => {
		const registry = fresh();
		expect(() => registry.validate("database", "Oracle", {})).toThrow(
			new UnknownIntegrationVariantError("database", "Oracle"),
		);
		expect(() => registry.require("database", "Oracle")).toThrow(
			'Unknown integration variant "Oracle" for group "database"',
		);
		expect(() => registry.require("acme/crm", "X")).toThrow('Unknown integration group "acme/crm"');
		expect(registry.validate("kv", "Redis", { source: "url", url: "redis://h" }).success).toBe(true);
	});

	it("looks the observability alias up as the current variant, and never lists it", () => {
		const registry = fresh();
		const def = registry.get("observability", "Open Telemetry Logs");
		expect(def?.variant).toBe("Open Telemetry");
		expect(registry.isBuiltIn("observability", "Open Telemetry Logs")).toBe(true);
		expect(registry.variants("observability").map((d) => d.variant)).toEqual(["Open Telemetry", "Loki"]);
		expect(registry.tags("observability", "Open Telemetry Logs")).toEqual(["logs", "metrics", "traces"]);
	});

	it("gives every built-in database variant the hooks DbFactory needs", () => {
		for (const def of fresh().variants("database")) {
			expect(typeof def.connect).toBe("function");
			expect(typeof def.create).toBe("function");
			expect(["sql", "js"]).toContain(def.extras.conditionEditor);
		}
	});
});

describe("IntegrationRegistry: per project (I6)", () => {
	it("a project's variant is visible to that project only, beside every shared one", () => {
		const registry = fresh();
		registry.register(kvVariant("Upstash"), "p1");
		expect(registry.get("kv", "Upstash", "p1")?.label).toBe("Upstash");
		expect(registry.get("kv", "Upstash", "p2")).toBeUndefined();
		expect(registry.get("kv", "Upstash")).toBeUndefined();
		expect(registry.variants("kv", "p1").map((d) => d.variant)).toEqual(["Redis", "Memcached", "Upstash"]);
		expect(registry.variants("kv", "p2").map((d) => d.variant)).toEqual(["Redis", "Memcached"]);
		expect(registry.isBuiltIn("kv", "Upstash")).toBe(false);
		expect(() => registry.require("kv", "Upstash", "p2")).toThrow(UnknownIntegrationVariantError);
	});

	it("two projects may hold different versions of the same plugin variant", () => {
		const registry = fresh();
		registry.register(kvVariant("Upstash", { label: "v1" }), "p1");
		registry.register(kvVariant("Upstash", { label: "v2" }), "p2");
		expect([registry.get("kv", "Upstash", "p1")?.label, registry.get("kv", "Upstash", "p2")?.label]).toEqual([
			"v1",
			"v2",
		]);
		expect(() => registry.register(kvVariant("Upstash"), "p1")).toThrow("already registered");
		expect(registry.unregister("kv", "Upstash", "p1")).toBe(true);
		expect(registry.get("kv", "Upstash", "p2")?.label).toBe("v2");
	});

	it("a project's variant takes no built-in name, and its group is listed for it alone", () => {
		const registry = fresh();
		expect(() => registry.register(kvVariant("Redis"), "p1")).toThrow("already registered");
		registry.register({ ...kvVariant("Hub"), group: "acme/crm" } as IntegrationVariantDef, "p1");
		expect(registry.groups("p1").at(-1)).toBe("acme/crm");
		expect(registry.groups("p2")).toEqual([...BUILT_IN_INTEGRATION_GROUPS]);
		expect(registry.hasGroup("acme/crm", "p2")).toBe(false);
	});

	it("checks a database's dbType against the shared ones and the project's own only", () => {
		const registry = fresh();
		const db = (variant: string, dbType: string) =>
			({ group: "database", variant, label: variant, configSchema, extras: { conditionEditor: "sql", dbType } }) as IntegrationVariantDef;
		registry.register(db("Acme", "acme"), "p1");
		registry.register(db("Acme", "acme"), "p2");
		expect(() => registry.register(db("Other", "ACME"), "p1")).toThrow('reuses dbType "ACME"');
		expect(() => registry.register(db("Pg2", "pg"), "p1")).toThrow('reuses dbType "pg"');
	});
});

describe("the SDK's built-in names (plugin lint rules)", () => {
	it("list every built-in variant name and alias, and every database dbType", () => {
		const registry = fresh();
		for (const group of BUILT_IN_INTEGRATION_GROUPS)
			expect([...BUILT_IN_VARIANT_NAMES[group]].sort()).toEqual(registry.names(group).sort());
		expect([...BUILT_IN_DB_TYPES].sort()).toEqual(
			registry.variants("database").map((v) => v.extras.dbType).sort(),
		);
	});
});
