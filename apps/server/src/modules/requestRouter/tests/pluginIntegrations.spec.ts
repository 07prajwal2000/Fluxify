import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILT_IN_VARIANTS, IntegrationRegistry } from "@fluxify/adapters/integrations";
import { loadPluginIntegrations, type PluginIntegrationRef } from "../pluginIntegrations";

const root = await mkdtemp(join(tmpdir(), "fluxify-plugin-integrations-"));
afterAll(() => rm(root, { recursive: true, force: true }));

/** a built module as the CLI writes it: a default-exported integration definition */
async function moduleFile(file: string, def: { group: string; variant: string }) {
	const path = join(root, file);
	await writeFile(
		path,
		`export default {
			name: "acme/crm/hub", label: "Hub", icon: "x", group: ${JSON.stringify(def.group)},
			variant: ${JSON.stringify(def.variant)}, config: {},
			connect: () => ({ hello: () => "hi" }),
		};`,
	);
	return path;
}

const ref = (projectId: string, entry: string, over: Partial<PluginIntegrationRef> = {}) => ({
	projectId,
	plugin: "acme/crm",
	version: "1.0.0+aa",
	group: "acme/crm",
	variant: "Hub",
	entry,
	...over,
});

describe("loadPluginIntegrations", () => {
	it("registers each ref for its own project, and unregisters one no longer listed", async () => {
		const registry = new IntegrationRegistry(BUILT_IN_VARIANTS);
		const entry = await moduleFile("hub.js", { group: "crm", variant: "Hub" });
		expect(await loadPluginIntegrations([ref("p1", entry), ref("p2", entry)], registry)).toEqual([]);
		const def = registry.get("acme/crm", "Hub", "p1");
		expect([def?.plugin, def?.label, typeof def?.create]).toEqual(["acme/crm", "Hub", "function"]);
		expect(registry.get("acme/crm", "Hub", "p3")).toBeUndefined();
		// the same set again imports nothing new
		expect(await loadPluginIntegrations([ref("p1", entry), ref("p2", entry)], registry)).toEqual([]);
		await loadPluginIntegrations([ref("p2", entry)], registry);
		expect(registry.get("acme/crm", "Hub", "p1")).toBeUndefined();
		expect(registry.get("acme/crm", "Hub", "p2")).toBeDefined();
		await loadPluginIntegrations([], registry);
	});

	it("refuses code that defines another kind than the approved one, and loads the rest", async () => {
		const registry = new IntegrationRegistry(BUILT_IN_VARIANTS);
		const good = await moduleFile("good.js", { group: "crm", variant: "Hub" });
		const sneaky = await moduleFile("sneaky.js", { group: "crm", variant: "Other" });
		const failures = await loadPluginIntegrations(
			[ref("p1", good), ref("p1", sneaky, { variant: "Approved" })],
			registry,
		);
		expect(failures).toEqual([expect.stringContaining("it defines acme/crm/Other, not the approved one")]);
		expect(registry.get("acme/crm", "Hub", "p1")).toBeDefined();
		expect(registry.get("acme/crm", "Approved", "p1")).toBeUndefined();
		await loadPluginIntegrations([], registry);
	});

	it("never loads a second version into the same process: the supervisor replaces it instead", async () => {
		const registry = new IntegrationRegistry(BUILT_IN_VARIANTS);
		const entry = await moduleFile("v1.js", { group: "crm", variant: "Hub" });
		await loadPluginIntegrations([ref("p1", entry)], registry);
		expect(await loadPluginIntegrations([ref("p1", entry, { version: "2.0.0+bb" })], registry)).toEqual([
			expect.stringContaining("version 1.0.0+aa is loaded here"),
		]);
		await loadPluginIntegrations([], registry);
	});

	it("loads a plugin integration importing @fluxify/sdk in worker registration", async () => {
		const registry = new IntegrationRegistry(BUILT_IN_VARIANTS);
		const path = join(root, "sdkImport.js");
		await writeFile(
			path,
			`import { isIntegrationGroupName } from "@fluxify/sdk/integrations";
			export default {
				name: "acme/crm/sdkImport", label: "SdkImport", icon: "x", group: "crm",
				variant: "SdkImport", config: {},
				connect: () => ({ valid: isIntegrationGroupName("acme/crm") }),
			};`,
		);
		expect(
			await loadPluginIntegrations(
				[ref("p1", path, { variant: "SdkImport" })],
				registry,
			),
		).toEqual([]);
		const def = registry.get("acme/crm", "SdkImport", "p1");
		expect(def).toBeDefined();
		expect(((await def?.create({})) as any).valid).toBe(true);
		await loadPluginIntegrations([], registry);
	});
});
