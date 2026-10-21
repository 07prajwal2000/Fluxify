import { afterEach, describe, expect, it } from "bun:test";
import { closeCtxIntegrations, type ModuleBlockRun } from "@fluxify/blocks";
import { hydrateIntegrations, OWNER_KEY } from "../../../loaders/integrationsLoader";
import { withGrantedContext } from "../pluginPermissions";

const LABEL = "plugin acme/echo@1.0.0 block acme/echo/step";
const kvConfig = (owner: string | null) => ({ group: "kv", variant: "Redis", [OWNER_KEY]: owner });

afterEach(async () => {
	hydrateIntegrations("mine", { kv: {}, plugin: {} });
	hydrateIntegrations("other", { kv: {}, plugin: {} });
	await closeCtxIntegrations();
});

const get =
	(id: string): ModuleBlockRun =>
	async ({ ctx }) => ({ output: await ctx.integrations!.get<string>(id) });
const call = (run: ModuleBlockRun, integrations: string[]) =>
	withGrantedContext(run, { integrations, appconfig: false }, LABEL)({
		params: {},
		ctx: { projectId: "mine", vars: {}, kvFactory: { getKvAdapter: (id: string) => `kv:${id}` } } as never,
	});

describe("ctx.integrations in a plugin block", () => {
	it("opens an integration of this project, by group or by variant grant", async () => {
		hydrateIntegrations("mine", { kv: { "kv-1": kvConfig("mine") } });
		expect(await call(get("kv-1"), ["kv"])).toEqual({ output: "kv:kv-1" });
		expect(await call(get("kv-1"), ["kv/Redis"])).toEqual({ output: "kv:kv-1" });
	});

	it("denies a kind that is not granted, naming the block", async () => {
		hydrateIntegrations("mine", { kv: { "kv-1": kvConfig("mine") } });
		await expect(call(get("kv-1"), ["database", "kv/Memcached"])).rejects.toThrow(
			`${LABEL} was not granted kv integrations; approve a version that asks for it`,
		);
	});

	it("treats another project's integration like an unknown id", async () => {
		hydrateIntegrations("other", { kv: { "kv-2": kvConfig("other") } });
		await expect(call(get("kv-2"), ["kv"])).rejects.toThrow(
			`${LABEL}: integration 'kv-2' does not exist, has no value in this environment, or belongs to another project`,
		);
		await expect(call(get("nope"), ["kv"])).rejects.toThrow("does not exist");
	});

	it("names the reason an environment has no value for it", async () => {
		hydrateIntegrations("mine", { kv: {} }, { "kv-3": "Cache has no development value" });
		await expect(call(get("kv-3"), ["kv"])).rejects.toThrow("Cache has no development value");
	});

	it("says so when the param was left empty", async () => {
		await expect(
			call(async ({ ctx }) => ({ output: await ctx.integrations!.get(undefined) }), ["kv"]),
		).rejects.toThrow(`${LABEL}: no integration was selected`);
	});
});
