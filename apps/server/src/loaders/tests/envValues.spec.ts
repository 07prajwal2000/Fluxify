import { describe, expect, it } from "bun:test";
import { pickValue } from "../../lib/envValues";
import { getAppConfig, hydrateAppConfig } from "../appconfigLoader";
import {
	configForEnv,
	dbIntegrationsCache,
	hydrateIntegrations,
	resolveIntegrationConfig,
} from "../integrationsLoader";

describe("pickValue", () => {
	it("production always reads its own value", () => {
		expect(pickValue("production", false, "prod", "dev")).toBe("prod");
		expect(pickValue("production", true, "prod", null)).toBe("prod");
	});

	it("development reads its own value, and nothing else, unless synced", () => {
		expect(pickValue("development", false, "prod", "dev")).toBe("dev");
		expect(pickValue("development", false, "prod", null)).toBeNull();
		expect(pickValue("development", false, "prod", undefined)).toBeNull();
		expect(pickValue("development", true, "prod", "dev")).toBe("prod");
	});
});

describe("integration config per environment", () => {
	const row = {
		id: "i",
		group: "kv",
		variant: "Redis",
		projectId: "p",
		config: { source: "credentials", host: "prod-redis", port: 6379 },
		devConfig: { source: "credentials", host: "dev-redis", port: 6379 },
		syncDev: false,
	};

	it("resolves the config the environment uses", () => {
		expect(resolveIntegrationConfig(row, {}, "production").host).toBe("prod-redis");
		expect(resolveIntegrationConfig(row, {}, "development").host).toBe("dev-redis");
		expect(resolveIntegrationConfig({ ...row, syncDev: true }, {}, "development").host).toBe(
			"prod-redis",
		);
	});

	it("expands cfg: references against the app config it is given", () => {
		const cfg = { ...row, config: { ...row.config, host: "cfg:HOST" }, devConfig: { ...row.devConfig, host: "cfg:HOST" } };
		expect(resolveIntegrationConfig(cfg, { HOST: "prod.example" }, "production").host).toBe("prod.example");
		expect(resolveIntegrationConfig(cfg, { HOST: "dev.example" }, "development").host).toBe("dev.example");
	});

	it("has no config for development without one, and does not borrow production's", () => {
		expect(configForEnv({ ...row, devConfig: null }, "development")).toBeNull();
		expect(resolveIntegrationConfig({ ...row, devConfig: null }, {}, "development")).toBeNull();
	});
});

describe("a missing development value fails at use", () => {
	it("throws the reason when a missing integration is read, and only then", () => {
		hydrateIntegrations(
			"env-p1",
			{ db: { present: { host: "h" } } },
			{ absent: "integration db_main has no development value" },
		);
		expect(dbIntegrationsCache.present).toEqual({ host: "h" });
		expect(() => dbIntegrationsCache.absent).toThrow("integration db_main has no development value");
		// iteration and `in` never see it, so a cache walk cannot trip over it
		expect(Object.keys(dbIntegrationsCache)).not.toContain("absent");
		expect("absent" in dbIntegrationsCache).toBe(false);

		// the next publish for the project replaces the reasons
		hydrateIntegrations("env-p1", { db: { present: { host: "h" }, absent: { host: "x" } } });
		expect(dbIntegrationsCache.absent).toEqual({ host: "x" });
	});

	it("throws for an app config key development has no value for", () => {
		hydrateAppConfig("env-p2", { A: "1" }, ["B"]);
		expect(getAppConfig("env-p2", "A")).toBe("1");
		expect(() => getAppConfig("env-p2", "B")).toThrow("app config key B has no development value");
		// a key that never existed is still just undefined
		expect(getAppConfig("env-p2", "C")).toBeUndefined();
		hydrateAppConfig("env-p2", { A: "1", B: "2" });
		expect(getAppConfig("env-p2", "B")).toBe("2");
	});
});

describe("walking a cache by stale ids", () => {
	it("does not trip the guard", async () => {
		const { unguarded } = await import("../integrationsLoader");
		hydrateIntegrations("env-p3", { kv: { alive: { host: "h" } } }, { gone: "integration k has no development value" });
		const { kvIntegrationsCache } = await import("../integrationsLoader");
		expect(() => kvIntegrationsCache.gone).toThrow("has no development value");
		// what connection managers read when closing the client of a removed integration
		expect(unguarded(kvIntegrationsCache).gone).toBeUndefined();
		expect(unguarded(kvIntegrationsCache).alive).toEqual({ host: "h" });
	});
});
