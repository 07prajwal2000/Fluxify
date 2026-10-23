import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import { ctxIntegrationStats } from "@fluxify/blocks";
import { param } from "@fluxify/sdk/blocks";
import { type TriggerConnection, type TriggerContext, trigger } from "@fluxify/sdk/triggers";
import { z } from "zod";
import { hydrateIntegrations, OWNER_KEY } from "../../../loaders/integrationsLoader";
import { applyPluginTrigger, shutdownPluginTriggers } from "../pluginTriggerRuntime";
import { strayErrorOwner } from "../strayErrors";
import {
	appConfig,
	artifact,
	fastLimits,
	install,
	PROJECT,
	resetLimits,
	uninstallAll,
	unloadWorkflow,
	workflow,
} from "./pluginTriggerHarness";

const KIND = "acme/t/emit";
const g = globalThis as {
	ptRuns?: any[];
	ptFailUntil?: number;
	ptGate?: Promise<void>;
};
/** records each run's `trigger`; fails while `ptFailUntil` says so; waits on `ptGate` */
const WORKFLOW_SOURCE = `const g = globalThis;
(g.ptRuns ??= []).push(ctx.vars.trigger);
if (g.ptRuns.length < (g.ptFailUntil ?? 0)) throw new Error("boom " + g.ptRuns.length);
if (g.ptGate) await g.ptGate;
return { successful: true };`;

/** starts trigger `id` and hands back its `ctx` */
async function started(id = "t1", overrides: Parameters<typeof artifact>[2] = {}, permissions?: any) {
	let ctx!: TriggerContext;
	const def = trigger({
		label: "Emit",
		icon: "./e.svg",
		name: KIND,
		permissions: { integrations: ["acme/fake"] },
		params: { every: param.number({ default: 5 }), token: param.secret() },
		start: async (c) => ((ctx = c as never), async () => {}),
	});
	install(def, permissions);
	await applyPluginTrigger(id, artifact(id, KIND, overrides));
	return ctx;
}

const connection: TriggerConnection = {
	raw: "client",
	commit: async () => {},
	moveToDLQ: async () => {},
	lag: async () => null,
};

beforeEach(() => {
	fastLimits();
	g.ptRuns = [];
	g.ptFailUntil = 0;
	g.ptGate = undefined;
	appConfig({ TOKEN: "s3cret" });
	workflow(WORKFLOW_SOURCE);
});
afterEach(async () => {
	await shutdownPluginTriggers();
	uninstallAll();
});
afterAll(resetLimits);

describe("emit", () => {
	it("runs the workflow in this process with the events, their meta and the very connection", async () => {
		const ctx = await started();
		await ctx.emit([{ n: 1 }, { n: 2 }], { connection });
		const [run] = g.ptRuns!;
		expect(run.source).toBe(`plugin:${KIND}`);
		expect(run.data.map((e: any) => e.data)).toEqual([{ n: 1 }, { n: 2 }]);
		expect(run.data[0].meta).toEqual({
			receivedAt: expect.any(String),
			source: `plugin:${KIND}`,
			attempt: 1,
		});
		expect(run.meta).toMatchObject({ size: 2, attempt: 1 });
		expect(run.connection).toBe(connection);
		// no connection passed: the workflow sees none
		await ctx.emit([1]);
		expect(g.ptRuns![1].connection).toBeUndefined();
	});

	it("without retry runs once and rejects with the run's error", async () => {
		g.ptFailUntil = 5;
		const ctx = await started("t1", { maxAttempts: 5 });
		await expect(ctx.emit([1])).rejects.toThrow("boom 1");
		expect(g.ptRuns).toHaveLength(1);
	});

	it("with retry reruns by the Attempts setting, backing off, and resolves once a run succeeds", async () => {
		g.ptFailUntil = 3;
		const ctx = await started("t1", {
			maxAttempts: 3,
			retryDelayMs: 20,
			plugin: { ...artifact("t1", KIND).plugin!, retry: true },
		});
		const began = Date.now();
		await ctx.emit([1]);
		// 20 ms, then 40 ms
		expect(Date.now() - began).toBeGreaterThanOrEqual(55);
		expect(g.ptRuns!.map((r) => r.data[0].meta.attempt)).toEqual([1, 2, 3]);
	});

	it("with retry rejects after the last attempt, capped at 5", async () => {
		g.ptFailUntil = 100;
		const ctx = await started("t1", {
			maxAttempts: 20,
			plugin: { ...artifact("t1", KIND).plugin!, retry: true },
		});
		await expect(ctx.emit([1])).rejects.toThrow("boom 5");
		expect(g.ptRuns).toHaveLength(5);
	});

	it("rejects without running when the workflow is not loaded, or the instance stopped", async () => {
		const ctx = await started();
		unloadWorkflow();
		await expect(ctx.emit([1])).rejects.toThrow(`workflow ${artifact("t1", KIND).workflowId} is not loaded on this worker`);
		workflow(WORKFLOW_SOURCE);
		await applyPluginTrigger("t1", null);
		await expect(ctx.emit([1])).rejects.toThrow("trigger t1 is no longer running");
		await expect(ctx.emit({} as never)).rejects.toThrow("emit(events) takes an array");
		expect(g.ptRuns).toEqual([]);
	});

	it("runs concurrent emits side by side", async () => {
		let open!: () => void;
		g.ptGate = new Promise<void>((r) => (open = r));
		const ctx = await started();
		const both = Promise.all([ctx.emit([1]), ctx.emit([2])]);
		await Bun.sleep(20);
		expect(g.ptRuns).toHaveLength(2);
		open();
		await both;
	});
});

describe("ctx", () => {
	let created = 0;
	const closed: unknown[] = [];
	beforeAll(() => {
		integrationRegistry.register(
			{
				group: "acme/fake",
				variant: "Fake",
				label: "Fake",
				configSchema: z.object({}),
				create: () => ({ client: ++created }),
				close: (client: unknown) => void closed.push(client),
			} as never,
			PROJECT,
		);
		hydrateIntegrations(PROJECT, {
			plugin: { "int-f": { group: "acme/fake", variant: "Fake", [OWNER_KEY]: PROJECT } },
		});
	});
	afterAll(() => integrationRegistry.unregister("acme/fake", "Fake", PROJECT));

	it("has its params defaulted, and reads the secret its param names", async () => {
		const ctx = await started("t1", { source: { token: "cfg:TOKEN" } });
		expect(ctx.params).toEqual({ every: 5, token: "cfg:TOKEN" });
		expect(ctx.getConfig("TOKEN")).toBe("s3cret");
		expect(() => ctx.getConfig("OTHER")).toThrow("getConfig('OTHER') is not allowed");
	});

	it("opens a granted integration once per instance from the shared pool, and releases it on stop", async () => {
		const leases = ctxIntegrationStats().leases;
		const ctx = await started("t1", {}, { integrations: ["acme/fake"], appconfig: false });
		const client = await ctx.integrations.get("int-f");
		expect(await ctx.integrations.get("int-f")).toBe(client);
		expect(ctxIntegrationStats().leases).toBe(leases + 1);
		await applyPluginTrigger("t1", null);
		expect(ctxIntegrationStats().leases).toBe(leases);
	});

	it("refuses an integration its approval did not grant", async () => {
		const ctx = await started("t1", {}, { integrations: [], appconfig: false });
		await expect(ctx.integrations.get("int-f")).rejects.toThrow("was not granted acme/fake integrations");
	});

	it("is the scope of the author's background loop, but not of the workflow run emit starts", async () => {
		g.ptRuns = [];
		let inLoop: unknown;
		let inWorkflow: unknown;
		const def = trigger({
			label: "Loop",
			icon: "./l.svg",
			name: "acme/t/loop",
			start: async (ctx) => {
				void (async () => {
					await Bun.sleep(1);
					inLoop = strayErrorOwner(new Error("x"));
					(globalThis as any).ptOwner = () => (inWorkflow = strayErrorOwner(undefined));
					await ctx.emit([1]);
				})();
				return async () => {};
			},
		});
		workflow("globalThis.ptOwner(); return { successful: true };");
		install(def);
		await applyPluginTrigger("loop", artifact("loop", def.name));
		await Bun.sleep(30);
		expect(inLoop).toMatchObject({ entry: expect.any(String) });
		expect(inWorkflow).toBeUndefined();
	});
});
