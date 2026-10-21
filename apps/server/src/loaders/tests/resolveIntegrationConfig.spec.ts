import { describe, expect, it } from "bun:test";
import { OWNER_KEY, resolveIntegrationConfig } from "../integrationsLoader";

/** What the caches held for each group before the registry (#902); resolution now goes through it. */
const row = (group: string, variant: string, config: Record<string, unknown>) => ({
	id: "i",
	group,
	variant,
	projectId: "p",
	config,
	syncDev: true,
});
const appConfig = { PASS: "secret", HOST: "db.internal", KEY: "sk-live", URL: "redis://r:6379" };
const resolve = (group: string, variant: string, config: Record<string, unknown>) =>
	resolveIntegrationConfig(row(group, variant, config), appConfig, "production");

describe("resolveIntegrationConfig", () => {
	it("expands a database row and stamps its dbType, timeout and pool size", () => {
		expect(
			resolve("database", "PostgreSQL", {
				dbType: "PostgreSQL",
				source: "credentials",
				host: "cfg:HOST",
				port: 5432,
				username: "u",
				password: "cfg:PASS",
				database: "d",
				queryTimeoutMs: 500,
				maxConnections: 7,
			}),
		).toEqual({
			dbType: "pg",
			source: "credentials",
			host: "db.internal",
			port: 5432,
			username: "u",
			password: "secret",
			database: "d",
			queryTimeoutMs: 500,
			maxConnections: 7,
			variant: "PostgreSQL",
			group: "database",
			[OWNER_KEY]: "p",
		});
	});

	it("parses each database variant's url with its own parser", () => {
		expect(resolve("database", "MySQL", { source: "url", url: "mysql://u:p@h:3306/d" })).toMatchObject({
			host: "h",
			database: "d",
			dbType: "mysql",
		});
		expect(resolve("database", "MongoDB", { source: "url", url: "mongodb://h:27017/d" })).toMatchObject({
			host: "h",
			dbType: "mongo",
		});
	});

	it("resolves kv, ai and queue rows like before", () => {
		expect(resolve("kv", "Redis", { source: "url", url: "cfg:URL" })).toMatchObject({
			url: "redis://r:6379",
			variant: "Redis",
		});
		expect(resolve("ai", "OpenAI", { apiKey: "cfg:KEY", model: "m" })).toMatchObject({
			apiKey: "sk-live",
			variant: "OpenAI",
		});
		expect(resolve("queue", "Kafka", { brokers: "cfg:HOST", ssl: false })).toEqual({
			brokers: "db.internal",
			ssl: false,
			variant: "Kafka",
			group: "queue",
			[OWNER_KEY]: "p",
		});
	});

	it("caches a row stored under the old observability name as the current variant", () => {
		const config = resolve("observability", "Open Telemetry Logs", {
			baseUrl: "https://otel.example.com",
			credentials: "abc",
		});
		expect(config.variant).toBe("Open Telemetry");
		expect(config.group).toBe("observability");
	});

	it("resolves an mcp row with its headers expanded", () => {
		expect(
			resolve("mcp", "http", { url: "https://m", auth: "headers", headers: [{ key: "A", value: "cfg:KEY" }] }),
		).toMatchObject({ url: "https://m", variant: "http", group: "mcp" });
	});

	it("leaves an unknown group or variant out, as before", () => {
		expect(resolve("database", "Oracle", { source: "credentials" })).toBeNull();
		expect(resolve("acme/crm", "X", {})).toBeNull();
	});
});
