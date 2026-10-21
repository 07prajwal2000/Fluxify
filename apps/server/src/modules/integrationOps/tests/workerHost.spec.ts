import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const handlers = new Map<string, (payload: { sealed: string }) => Promise<unknown>>();
const subscribed: Array<{ subject: string; queue?: string }> = [];
const nats = { ...(await import("@fluxify/common/nats")) };
mock.module("@fluxify/common/nats", () => ({
	...nats,
	rpcRespond: (_nc: unknown, subject: string, h: any, options: { queue?: string }) => {
		handlers.set(subject, h);
		subscribed.push({ subject, queue: options.queue });
		return { stop: async () => {} };
	},
}));
const dbNats = { ...(await import("../../../db/nats")) };
mock.module("../../../db/nats", () => ({ ...dbNats, natsConnection: () => ({}) }));

const { BUILT_IN_VARIANTS, IntegrationRegistry } = await import("@fluxify/adapters/integrations");
const { EncryptionService } = await import("../../../lib/encryption");
const { serveIntegrationOps } = await import("../workerHost");

// a variant only this worker knows, standing in for a plugin's (I6)
const seen: unknown[] = [];
const registry = new IntegrationRegistry(BUILT_IN_VARIANTS);
registry.register({
	group: "acme/crm",
	variant: "Hub",
	label: "Hub",
	configSchema: z.object({ token: z.string() }),
	async test(config: any, ctx: any) {
		seen.push({ config, appConfig: Object.fromEntries(ctx.appConfig) });
		if (ctx.appConfig.get("TOKEN") === "bad") throw new Error("401 from hub");
		return { success: true, error: "" };
	},
	inspectRequest: z.object({ object: z.string() }),
	inspect: async (_config: any, request: any) => ({ object: request.object, fields: ["id"] }),
} as any);

let projectConfig: any = {
	appConfig: { TOKEN: "secret", PORT: 1 },
	missingValues: { integrations: {}, appConfig: ["DEV_ONLY_MISSING"] },
};
serveIntegrationOps("p1", "development", () => projectConfig, { registry });

const call = (op: string, body: object) =>
	handlers.get(`fluxify.dev.integrations.${op}.p1`)!({
		sealed: EncryptionService.encrypt(
			JSON.stringify({ projectId: "p1", group: "acme/crm", variant: "Hub", timeoutMs: 1_000, ...body }),
		),
	});

describe("serveIntegrationOps", () => {
	it("answers each op on the project's subject in its env, one worker per request", () => {
		expect(subscribed.filter((s) => s.subject.endsWith(".p1"))).toEqual(
			["test", "describe", "inspect"].map((op) => ({
				subject: `fluxify.dev.integrations.${op}.p1`,
				queue: "fluxify_integration_ops",
			})),
		);
	});

	it("runs the worker's variant with this env's app config, never the request's", async () => {
		expect(await call("test", { config: { token: "cfg:TOKEN" } })).toEqual({ success: true, error: "" });
		expect(seen.at(-1)).toEqual({ config: { token: "cfg:TOKEN" }, appConfig: { TOKEN: "secret" } });
	});

	it("validates and answers inspect with the variant's own shapes", async () => {
		expect(await call("inspect", { config: { token: "t" }, request: { object: "deal" } })).toEqual({
			object: "deal",
			fields: ["id"],
		});
		await expect(call("inspect", { config: { token: "t" }, request: {} })).rejects.toThrow("Invalid request: object:");
	});

	it("a variant this worker lacks is named", async () => {
		const error = await call("test", { variant: "Nope", config: {} }).catch((e) => e);
		expect(error.code).toBe("NOT_FOUND");
		expect(error.message).toBe('Integration variant "acme/crm/Nope" is not installed on this development worker');
	});

	it("a hook that throws returns its message, not a stack", async () => {
		projectConfig = { ...projectConfig, appConfig: { TOKEN: "bad" } };
		const error = await call("test", { config: { token: "cfg:TOKEN" } }).catch((e) => e);
		expect(error.code).toBe("VALIDATION_FAILED");
		expect(error.message).toBe("401 from hub");
		expect(error.details).toBeUndefined();
	});

	it("a key this env has no value for fails the way the admin does", async () => {
		await expect(call("test", { config: { token: "cfg:DEV_ONLY_MISSING" } })).rejects.toThrow(
			"no development value",
		);
	});

	it("an op the variant has no hook for says so", async () => {
		await expect(call("describe", { config: { token: "t" } })).rejects.toThrow(
			"Metadata is not available for acme/crm/Hub integrations",
		);
	});

	it("refuses another project's request, and waits for its config", async () => {
		await expect(call("test", { projectId: "p2", config: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
		projectConfig = undefined;
		await expect(call("test", { config: { token: "t" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("serveIntegrationOps: a plugin variant's hook runs in its own child (I6)", () => {
	const isolated: any[] = [];
	const pluginRef = {
		projectId: "p2",
		plugin: "acme/crm",
		version: "1.0.0+aa",
		group: "acme/crm",
		variant: "Deal",
		entry: "/plugins/deal.js",
	};
	const p2Config = { appConfig: { TOKEN: "secret", OTHER: "never sent" } } as any;
	serveIntegrationOps("p2", "development", () => p2Config, {
		registry,
		pluginRefs: () => [pluginRef, { ...pluginRef, projectId: "p9" }],
		runIsolated: async (request) => {
			isolated.push(request);
			return { success: true };
		},
	});
	const callP2 = (op: string, body: object) =>
		handlers.get(`fluxify.dev.integrations.${op}.p2`)!({
			sealed: EncryptionService.encrypt(
				JSON.stringify({ projectId: "p2", group: "acme/crm", timeoutMs: 1_000, ...body }),
			),
		});

	it("hands the child the stored config and only the values it references, never the sealed payload", async () => {
		expect(
			await callP2("test", { variant: "Deal", integrationId: "i1", config: { token: "cfg:TOKEN" } }),
		).toEqual({ success: true });
		expect(isolated).toEqual([
			{
				ref: pluginRef,
				op: "test",
				call: { group: "acme/crm", variant: "Deal", config: { token: "cfg:TOKEN" } },
				appConfig: [["TOKEN", "secret"]],
				timeoutMs: 1_000,
			},
		]);
	});

	it("a variant this worker has no ref for is not installed, and runs nowhere", async () => {
		isolated.length = 0;
		await expect(callP2("test", { variant: "Missing", config: {} })).rejects.toThrow(
			'Integration variant "acme/crm/Missing" is not installed on this development worker',
		);
		expect(isolated).toEqual([]);
	});

	it("a built-in still runs here", async () => {
		await expect(
			callP2("test", { group: "kv", variant: "Redis", config: { source: "credentials" } }),
		).rejects.toThrow();
		expect(isolated).toEqual([]);
	});
});
