// The integration contract (I5), run against `@fluxify/sdk/testing`
// (tests/conformance.spec.ts) and the real runtime: the registry, the worker's
// `ctx.integrations` pool and the op hook runner
// (packages/blocks/builtin/tests/conformance.spec.ts). Workspace-only.
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { param } from "../blocks.js";
import { type AnyIntegration, integration } from "../integrations.js";

export type IntegrationRunner = {
	/** what a block's `ctx.integrations.get` hands out for this config; pooled until `reset` */
	get(def: AnyIntegration, config: Record<string, unknown>, appConfig?: Record<string, string>): Promise<any>;
	/** Test connection, describe or inspect, as the worker runs them */
	op(
		def: AnyIntegration,
		op: "test" | "describe" | "inspect",
		config: Record<string, unknown>,
		appConfig?: Record<string, string>,
		request?: unknown,
	): Promise<any>;
	/** closes every pooled client, as a worker shutting down */
	reset(): Promise<void>;
};

const SECRET = "s3cret-value";
const APP_CONFIG = { API_TOKEN: SECRET, OTHER: "other-value" };

/** a plugin's own group; counts every connect and close */
function hub(poolKey?: (config: { region: string; other?: string }) => unknown) {
	const seen = { connects: 0, closes: 0 };
	const def = integration({
		name: "conf/test/hub",
		label: "Hub",
		icon: "./hub.svg",
		group: "hub",
		variant: "Fake",
		config: {
			region: param.string({ required: true }),
			token: param.secret({ required: true }),
			other: param.string(),
		},
		...(poolKey && { poolKey }),
		async connect(config, ctx) {
			seen.connects++;
			return {
				n: seen.connects,
				key: config.token,
				token: ctx.getConfig(config.token),
				read: async (key: string) => ctx.getConfig(key),
			};
		},
		close: () => void seen.closes++,
		test: async (client) => ({ success: client.token === SECRET }),
		inspect: async (_client, request) => ({ echo: request.key }),
		inspectRequest: z.object({ key: z.string() }),
	});
	return { def, seen };
}

const config = { region: "eu", token: "API_TOKEN" };

export function integrationConformance(name: string, runner: IntegrationRunner) {
	describe(`${name}: integrations`, () => {
		it("connect gets the secret's key, and getConfig reads that key's value", async () => {
			const { def } = hub();
			const client = await runner.get(def, config, APP_CONFIG);
			expect([client.key, client.token]).toEqual(["API_TOKEN", SECRET]);
			await runner.reset();
		});

		it("getConfig denies any key no secret field names, naming the key and never a value", async () => {
			const { def } = hub();
			const client = await runner.get(def, config, APP_CONFIG);
			const error: Error = await client.read("OTHER").catch((e: Error) => e);
			expect(error.message).toContain("getConfig('OTHER') is not allowed");
			expect(error.message).not.toContain("other-value");
			await runner.reset();
		});

		it("a secret with no value in the environment fails connect, without a value in the message", async () => {
			const { def } = hub();
			const r = await runner.op(def, "test", config, { OTHER: "other-value" });
			expect(r).toEqual({
				success: false,
				error: "integration conf/test/hub: app config key 'API_TOKEN' has no value in this environment",
			});
		});

		it("pools one client per poolKey, by default the whole config", async () => {
			const { def, seen } = hub();
			const a = await runner.get(def, config, APP_CONFIG);
			const b = await runner.get(def, { ...config }, APP_CONFIG);
			const c = await runner.get(def, { ...config, region: "us" }, APP_CONFIG);
			expect([a === b, a === c, seen.connects]).toEqual([true, false, 2]);
			// a changed secret value is a new client, though the key is the same
			const d = await runner.get(def, config, { API_TOKEN: "rotated" });
			expect([d === a, d.token]).toEqual([false, "rotated"]);
			await runner.reset();
		});

		it("a custom poolKey decides what shares a client", async () => {
			const { def, seen } = hub((c) => c.region);
			const a = await runner.get(def, { ...config, other: "x" }, APP_CONFIG);
			const b = await runner.get(def, { ...config, other: "y" }, APP_CONFIG);
			expect([a === b, seen.connects]).toEqual([true, 1]);
			await runner.reset();
		});

		it("close runs once per client: on shutdown, and after an op's fresh client", async () => {
			const { def, seen } = hub();
			await runner.get(def, config, APP_CONFIG);
			await runner.get(def, config, APP_CONFIG);
			await runner.reset();
			await runner.reset();
			expect(seen.closes).toBe(1);
			expect(await runner.op(def, "test", config, APP_CONFIG)).toEqual({ success: true });
			expect([seen.connects, seen.closes]).toEqual([2, 2]);
		});

		it("inspect checks its request with inspectRequest before the hook runs", async () => {
			const { def, seen } = hub();
			await expect(runner.op(def, "inspect", config, APP_CONFIG, { key: 1 })).rejects.toThrow("Invalid request: key:");
			expect(seen.connects).toBe(0);
			expect(await runner.op(def, "inspect", config, APP_CONFIG, { key: "a" })).toEqual({ echo: "a" });
		});

		it("a hook the integration does not define is not available", async () => {
			const { def } = hub();
			await expect(runner.op(def, "describe", config, APP_CONFIG)).rejects.toThrow(
				"Metadata is not available for conf/hub/Fake integrations",
			);
		});
	});
}
