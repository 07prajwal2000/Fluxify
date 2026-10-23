import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { OtlpSignal } from "../../observability/openTelemetryLogs";
import { integrationRegistry } from "..";
import { AnthropicIntegration } from "../../ai/anthropic";
import { GeminiIntegration } from "../../ai/gemini";
import { MistralIntegration } from "../../ai/mistral";
import { OpenAIIntegration } from "../../ai/openAi";
import { OpenAICompatibleIntegration } from "../../ai/openAiCompatible";
import * as dbIndex from "../../db/index";
import { MongoAdapter } from "../../db/mongoDbAdapter";
import { MySqlAdapter } from "../../db/mySqlAdapter";
import { PostgresAdapter } from "../../db/postgresAdapter";
import { MemcachedIntegration } from "../../kv/memcached";
import { RedisIntegration } from "../../kv/redis";
import { LokiLogger } from "../../observability/loki";
import { OpenTelemetryLogs } from "../../observability/openTelemetryLogs";
import * as legacy from "./legacyOps";

/**
 * Every built-in's `test` and `describe` hook against the switch it replaced
 * (`legacyOps.ts`): same driver call, same arguments, same answer, for each
 * outcome the driver can give. The drivers are stubbed; the container tests
 * cover the real ones.
 */

const appConfig = new Map([
	["HOST", "cfg-host"],
	["PASS", "cfg-pass"],
	["URL", "postgres://u:p@cfg-host:5432/d"],
	["KEY", "sk-cfg"],
]);

const DB = {
	PostgreSQL: [
		{ source: "credentials", host: "cfg:HOST", port: "5432", username: "u", password: "cfg:PASS", database: "d", ssl: "true" },
		{ source: "credentials", host: "h", port: 5432, username: "u", password: "p", database: "d" },
		{ source: "url", url: "cfg:URL" },
		{ source: "url", url: "postgres://u:p@h:5432/d?sslmode=require" },
		{ source: "url", url: "not a url" },
	],
	MySQL: [
		{ source: "credentials", host: "cfg:HOST", port: "3306", username: "u", password: "p", database: "d" },
		{ source: "url", url: "mysql://u:p@h:3306/d" },
		{ source: "url", url: "nope" },
	],
	MongoDB: [
		{ source: "credentials", host: "h", port: 27017, database: "d" },
		{ source: "url", url: "mongodb://u:p@h:27017/d" },
	],
};

/** driver outcomes: connected, refused with a reason, refused silently, connected with a warning */
const DB_OUTCOMES = [
	{ success: true },
	{ success: false, error: new Error("ECONNREFUSED") },
	{ success: false },
	{ success: true, warning: "no replica set" },
];

const DB_DRIVER = { PostgreSQL: PostgresAdapter, MySQL: MySqlAdapter, MongoDB: MongoAdapter } as const;

const ctx = (options: Record<string, unknown> = {}) => ({ appConfig, options });
const hook = (group: string, variant: string) => integrationRegistry.require(group, variant) as any;

afterEach(() => mock.restore());

/** Runs both sides with fresh copies (the extractors write into the config) and compares. */
async function compare(
	driver: ReturnType<typeof spyOn<any, any>>,
	config: unknown,
	legacyRun: (config: any) => Promise<unknown>,
	hookRun: (config: any) => Promise<unknown>,
) {
	const before = await legacyRun(structuredClone(config));
	const legacyArgs = driver.mock.calls.at(-1);
	const after = await hookRun(structuredClone(config));
	expect(after).toEqual(before);
	expect(driver.mock.calls.at(-1)).toEqual(legacyArgs);
}

describe("database test", () => {
	for (const [variant, configs] of Object.entries(DB)) {
		for (const outcome of DB_OUTCOMES) {
			it(`${variant}: ${JSON.stringify({ ...outcome, error: String(outcome.error) })}`, async () => {
				const driver = spyOn(DB_DRIVER[variant as keyof typeof DB_DRIVER], "testConnection").mockResolvedValue(
					outcome as any,
				);
				for (const config of configs) {
					await compare(
						driver,
						config,
						(c) => legacy.testDatabasesConnection(variant, c, appConfig),
						(c) => hook("database", variant).test(c, ctx()),
					);
				}
			});
		}
	}
});

describe("database describe", () => {
	it("opens the same connection get-metadata built", async () => {
		const introspect = spyOn(dbIndex, "introspectConnection").mockResolvedValue([]);
		for (const [variant, configs] of Object.entries(DB)) {
			for (const config of configs) {
				let before: unknown;
				try {
					before = legacy.buildConnection(variant, structuredClone(config), appConfig);
				} catch (error) {
					await expect(hook("database", variant).describe(structuredClone(config), ctx())).rejects.toThrow(
						(error as Error).message,
					);
					continue;
				}
				expect(await hook("database", variant).describe(structuredClone(config), ctx())).toEqual({ tables: [] });
				expect(introspect.mock.calls.at(-1)?.[0]).toEqual(before as any);
			}
		}
	});
});

describe("kv test", () => {
	for (const [variant, driver] of [["Redis", RedisIntegration], ["Memcached", MemcachedIntegration]] as const) {
		for (const outcome of [{ success: true }, { success: false, error: "NOAUTH" }, { success: false }]) {
			it(`${variant}: ${JSON.stringify(outcome)}`, async () => {
				const probe = spyOn(driver, "TestConnection").mockResolvedValue(outcome);
				await compare(
					probe,
					{ source: "credentials", host: "cfg:HOST", port: 6379, password: "cfg:PASS" },
					(c) => legacy.testKvConnection(variant, c, appConfig),
					(c) => hook("kv", variant).test(c, ctx()),
				);
			});
		}
	}
});

describe("ai test", () => {
	const PROVIDERS = {
		OpenAI: OpenAIIntegration,
		Anthropic: AnthropicIntegration,
		Gemini: GeminiIntegration,
		Mistral: MistralIntegration,
		"OpenAI Compatible": OpenAICompatibleIntegration,
	};
	for (const [variant, provider] of Object.entries(PROVIDERS)) {
		for (const ok of [true, false]) {
			it(`${variant}: ${ok}`, async () => {
				const probe = spyOn(provider as any, "TestConnection").mockResolvedValue(ok);
				await compare(
					probe,
					{ apiKey: "cfg:KEY", model: "m", baseUrl: "http://x" },
					(c) => legacy.testAiConnection(variant, c, appConfig),
					(c) => hook("ai", variant).test(c, ctx()),
				);
			});
		}
	}

	it("a provider's refusal reaches the caller as thrown", async () => {
		spyOn(OpenAIIntegration, "TestConnection").mockRejectedValue(new Error("401"));
		await expect(hook("ai", "OpenAI").test({ apiKey: "k", model: "m" }, ctx())).rejects.toThrow("401");
	});
});

describe("observability test", () => {
	const otel = { baseUrl: "http://otel:4318", credentials: "cfg:KEY" };
	const loki = { baseUrl: "http://loki:3100", credentials: "cfg:KEY" };
	for (const signal of ["logs", "traces", "metrics"] as OtlpSignal[]) {
		for (const ok of [true, false]) {
			it(`${signal}: ${ok}`, async () => {
				const otelProbe = spyOn(OpenTelemetryLogs, "TestConnection").mockResolvedValue(ok);
				const lokiProbe = spyOn(LokiLogger, "TestConnection").mockResolvedValue(ok);
				for (const [variant, config, probe] of [
					["Open Telemetry", otel, otelProbe],
					["Loki", loki, lokiProbe],
				] as const) {
					await compare(
						probe as any,
						config,
						(c) => legacy.testObservibilityConnection(variant, c, appConfig, signal),
						(c) => hook("observability", variant).test(c, ctx({ signal })),
					);
				}
			});
		}
	}

	it("rejects a malformed config the way the switch did", async () => {
		for (const variant of ["Open Telemetry", "Loki"]) {
			expect(await hook("observability", variant).test({ baseUrl: 1 }, ctx())).toEqual(
				await legacy.testObservibilityConnection(variant, { baseUrl: 1 }, appConfig, "logs"),
			);
		}
	});

	it("an alias resolves to the same hook", () => {
		expect(integrationRegistry.require("observability", "Open Telemetry Logs").test).toBe(
			hook("observability", "Open Telemetry").test,
		);
	});
});

describe("hooks every built-in has", () => {
	it("test on all, describe on databases and AI, inspect on databases, KV stores and AI", () => {
		for (const group of ["database", "kv", "ai", "observability", "queue", "mcp"]) {
			for (const def of integrationRegistry.variants(group) as any[]) {
				expect(typeof def.test).toBe("function");
				expect(typeof def.describe).toBe(["database", "ai"].includes(group) ? "function" : "undefined");
				expect(typeof def.inspect).toBe(["database", "kv", "ai"].includes(group) ? "function" : "undefined");
			}
		}
	});
});
