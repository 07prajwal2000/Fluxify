import { describe, expect, it } from "bun:test";
import { UnknownIntegrationVariantError } from "@fluxify/sdk/integrations";
import { integrationRegistry } from "..";
import * as legacy from "./legacySchemas";

/**
 * The registry must accept and reject exactly what the old enums and schemas
 * did. Each sample is checked as written and through every one-field mutation
 * (dropped, a number, empty, a `cfg:` reference), against the old schemas.
 */
const SAMPLES: Record<string, Record<string, Record<string, unknown>[]>> = {
	database: {
		PostgreSQL: [
			{ dbType: "PostgreSQL", username: "u", password: "p", host: "h", port: 5432, database: "d", source: "credentials", useSSL: true, maxConnections: 50 },
			{ source: "url", url: "postgres://u:p@h:5432/d?ssl=true", queryTimeoutMs: 1000 },
			{ source: "url", url: "cfg:DB_URL", maxConnections: 51 },
		],
		MySQL: [
			{ dbType: "MySQL", username: "u", password: "p", host: "h", port: "3306", database: "d", source: "credentials" },
			{ source: "url", url: "mysql://u:p@h:3306/d" },
		],
		MongoDB: [
			{ dbType: "MongoDB", host: "h", port: 27017, database: "d", source: "credentials", maxConnections: 100 },
			{ source: "url", url: "mongodb://h:27017/d" },
		],
	},
	kv: {
		Redis: [
			{ host: "h", port: 6379, database: "2", source: "credentials" },
			{ host: "h", port: 6379, database: "x", source: "credentials" },
			{ source: "url", url: "redis://h:6379" },
		],
		Memcached: [{ host: "h", port: 11211, source: "credentials" }, { source: "url", url: "h:11211" }],
	},
	ai: {
		OpenAI: [{ apiKey: "sk-x", model: "gpt" }],
		Anthropic: [{ apiKey: "cfg:KEY", model: "claude" }],
		Gemini: [{ apiKey: "k", model: "g" }],
		Mistral: [{ apiKey: "kk", model: "m" }],
		"OpenAI Compatible": [{ baseUrl: "https://llm.example.com", apiKey: "kk", model: "m" }],
	},
	observability: {
		"Open Telemetry": [
			{ baseUrl: "https://otel.example.com", credentials: "abc" },
			{ baseUrl: "cfg:URL", credentials: { username: "u", password: "p" }, protocol: "grpc", tlsMode: "mtls" },
			{ baseUrl: "https://o", credentials: "c", protocol: "grpc", tlsMode: "mtls", clientCert: "c", clientKey: "k" },
		],
		"Open Telemetry Logs": [{ baseUrl: "https://otel.example.com", credentials: "abc" }],
		Loki: [{ baseUrl: "https://loki.example.com", headers: { "X-Scope": "t" } }],
	},
	queue: {
		Kafka: [{ brokers: "b:9092", saslMechanism: "PLAIN", username: "u", sendTimeoutMs: 10 }],
		NATS: [{ servers: "nats://n:4222", tls: true }],
		SQS: [{ region: "us-east-1", endpoint: "http://localhost:4566" }],
		RabbitMQ: [
			{ host: "h", port: 5672, source: "credentials" },
			{ source: "url", url: "amqps://u:p@h/vhost" },
			{ source: "url", url: "http://h" },
		],
	},
	mcp: {
		http: [{ url: "https://mcp.example.com", headers: [{ key: "Authorization", value: "cfg:TOKEN" }] }],
	},
	baas: { Firebase: [{}], Supabase: [{}] },
};

function mutations(sample: Record<string, unknown>) {
	const out = [sample, {}, null, "text"];
	for (const key of Object.keys(sample)) {
		const { [key]: _, ...without } = sample;
		out.push(without);
		for (const value of [123, "", "cfg:KEY", true]) out.push({ ...sample, [key]: value });
	}
	return out;
}

/** The old lookup's answer: the parse result, or "unknown" where it returned no schema. */
function legacyParse(group: string, variant: string, config: unknown) {
	const schema = legacy.getSchema(group as never, variant);
	return schema ? schema.safeParse(config) : "unknown";
}

function registryParse(group: string, variant: string, config: unknown) {
	try {
		return integrationRegistry.validate(group, variant, config);
	} catch (error) {
		expect(error).toBeInstanceOf(UnknownIntegrationVariantError);
		return "unknown";
	}
}

const outcome = (result: ReturnType<typeof legacyParse>) =>
	result === "unknown" ? result : result.success ? { data: result.data } : "invalid";

describe("registry parity with the old enums and schemas", () => {
	for (const [group, variants] of Object.entries(SAMPLES)) {
		for (const [variant, samples] of Object.entries(variants)) {
			it(`${group}/${variant} accepts and rejects the same configs`, () => {
				for (const config of samples.flatMap(mutations)) {
					expect({ config, result: outcome(registryParse(group, variant, config)) }).toEqual({
						config,
						result: outcome(legacyParse(group, variant, config)),
					});
				}
			});
		}
	}

	it("treats unknown groups and variants as unknown, like the old lookup", () => {
		for (const [group, variant] of [
			["database", "Oracle"],
			["kv", "redis"],
			["ai", ""],
			["observability", "Splunk"],
			["queue", "Redis"],
			["mcp", "stdio"],
			["nope", "PostgreSQL"],
		]) {
			expect(registryParse(group!, variant!, {})).toBe("unknown");
			expect(legacyParse(group!, variant!, {})).toBe("unknown");
		}
	});

	it("lists the same groups and variants, in the same order, without the alias", () => {
		expect(integrationRegistry.groups()).toEqual(legacy.getIntegrationsGroups());
		for (const group of legacy.getIntegrationsGroups()) {
			expect(integrationRegistry.variants(group).map((def) => def.variant)).toEqual(
				legacy.getIntegrationsVariants(group),
			);
		}
	});

	it("tags every variant (and the alias) as before", () => {
		for (const [group, variants] of Object.entries(SAMPLES)) {
			for (const variant of [...Object.keys(variants), "Unknown"]) {
				expect(integrationRegistry.tags(group, variant)).toEqual(
					legacy.getIntegrationTags(group as never, variant),
				);
			}
		}
	});

	it("gives every database variant the condition editor it had", () => {
		for (const variant of legacy.databaseVariantSchema.options) {
			expect(integrationRegistry.require("database", variant).extras.conditionEditor).toBe(
				legacy.databaseConditionEditors[variant],
			);
		}
	});

	it("resolves the observability alias to the current name", () => {
		for (const name of legacy.observabilityLegacyVariants) {
			expect(integrationRegistry.get("observability", name)?.variant).toBe(
				legacy.normalizeObservabilityVariant(name),
			);
		}
		expect(integrationRegistry.names("observability").sort()).toEqual(
			[...legacy.observabilityVariantSchema.options, ...legacy.observabilityLegacyVariants].sort(),
		);
	});
});
