// A plugin adding a variant to a dependency's group (#899 part 2): registered
// into that group, tagged with the plugin that adds it, only while its
// dependencies load, and refused at approval on a name already taken.
import { afterEach, describe, expect, it } from "bun:test";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import { param } from "@fluxify/sdk/blocks";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";
import handleVariants from "../../../api/v1/integrations/variants/service";
import { variantClashes } from "../dependencies";
import type { PluginRow } from "../meta";
import { applyProjectPluginVariants, pluginVariantState, pluginVariantUnusable } from "../variants";
import { manifest } from "./fixtures";

const P = "p-dependency-variants";
const CRM = "other/crm";

/** `plugin`'s variant `variant` of group other/crm */
const variantOf = (plugin: string, variant: string) => ({
	...toIntegrationEntry({
		name: `${plugin}/${variant.toLowerCase()}`,
		label: variant,
		icon: "data:image/svg+xml,x",
		group: CRM,
		variant,
		config: { token: param.secret({ required: true }) },
		connect: () => ({}),
	} as never),
	entry: `dist/integrations/${variant.toLowerCase()}.js`,
});

/** approved and on everywhere unless `over` says otherwise */
const row = (name: string, variants: string[], deps: string[] = [], over: Partial<PluginRow> = {}) =>
	({
		name,
		version: "1.0.0",
		integrity: `sha-${name}`,
		approval: "approved",
		devEnabled: true,
		prodEnabled: true,
		manifest: {
			...manifest(name),
			integrations: variants.map((v) => variantOf(name, v)),
			...(deps.length && {
				dependencies: deps.map((plugin) => ({ name: `@${plugin}`, plugin, range: "^1.0.0" })),
			}),
		},
		...over,
	}) as PluginRow;

const crm = (over: Partial<PluginRow> = {}) => row(CRM, ["Hub"], [], over);
const pipe = (over: Partial<PluginRow> = {}) => row("acme/pipe", ["Pipe"], [CRM], over);
const registered = (variant: string) => integrationRegistry.get(CRM, variant, P)?.plugin;

afterEach(() => applyProjectPluginVariants(P, []));

describe("a variant added to a dependency's group", () => {
	it("is registered into that group, tagged with the plugin that adds it, and listed so", () => {
		applyProjectPluginVariants(P, [crm(), pipe()]);
		expect(registered("Hub")).toBe(CRM);
		expect(registered("Pipe")).toBe("acme/pipe");
		expect(pluginVariantState(P, CRM, "Pipe")?.plugin).toBe("acme/pipe");
		const group = handleVariants(P).find((g) => g.group === CRM)!;
		expect(group.variants.map((v) => [v.variant, v.plugin])).toEqual([
			["Hub", CRM],
			["Pipe", "acme/pipe"],
		]);
	});

	it("is not registered while its dependency is missing, pending, rejected or off", () => {
		for (const rows of [
			[pipe()],
			[crm({ approval: "pending" }), pipe()],
			[crm({ approval: "rejected" }), pipe()],
			[crm({ devEnabled: false, prodEnabled: false }), pipe()],
		]) {
			applyProjectPluginVariants(P, rows);
			expect(registered("Pipe")).toBeUndefined();
			expect(pluginVariantState(P, CRM, "Pipe")).toBeUndefined();
		}
	});

	it("follows its dependency's state each time the project is applied again", () => {
		applyProjectPluginVariants(P, [crm({ devEnabled: false, prodEnabled: false }), pipe()]);
		expect(registered("Pipe")).toBeUndefined();
		applyProjectPluginVariants(P, [crm(), pipe()]);
		expect(registered("Pipe")).toBe("acme/pipe");
		// the dependency off in production only: usable in development, refused in production naming why
		applyProjectPluginVariants(P, [crm({ prodEnabled: false }), pipe()]);
		expect(pluginVariantUnusable(P, CRM, "Pipe", "development")).toBeUndefined();
		expect(pluginVariantUnusable(P, CRM, "Pipe", "production")).toBe(
			`plugin acme/pipe cannot load: it needs plugin ${CRM} ^1.0.0: plugin ${CRM}@1.0.0 is not enabled in production`,
		);
		applyProjectPluginVariants(P, [pipe()]);
		expect(registered("Pipe")).toBeUndefined();
	});

	it("is refused at approval on a name the dependency or another dependent has, naming both", () => {
		const taken = row("acme/pipe", ["Hub"], [CRM], { approval: "pending" });
		expect(variantClashes(taken, [crm(), taken])).toEqual([
			`Plugin acme/pipe provides integration variant ${CRM}/Hub, which plugin ${CRM} already provides in this project`,
		]);
		const second = row("acme/flow", ["Pipe"], [CRM], { approval: "pending" });
		expect(variantClashes(second, [crm(), pipe(), second])[0]).toContain("which plugin acme/pipe already provides");
		// a dependent switched off or blocked still holds its name; a pending one does not yet
		expect(variantClashes(second, [crm({ devEnabled: false, prodEnabled: false }), pipe(), second])).toHaveLength(1);
		expect(variantClashes(second, [crm(), pipe({ approval: "pending" }), second])).toEqual([]);
	});
});
