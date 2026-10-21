import { afterEach, describe, expect, it } from "bun:test";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import { param } from "@fluxify/sdk/blocks";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";
import { BadRequestError } from "../../../../../errors/badRequestError";
import { applyPluginVariants, pluginVariantUnusable } from "../../../../../modules/plugins/variants";
import handleRequest, { variantConfigSchema } from "../service";

const P = "p-variants";
const OTHER = "p-other";

/** an approved plugin row with one variant of its own group, as the admin registers it */
const pluginRow = (over: { devEnabled?: boolean; prodEnabled?: boolean } = {}) => ({
	name: "acme/crm",
	version: "1.0.0",
	integrity: "sha512-x",
	approval: "approved" as const,
	devEnabled: true,
	prodEnabled: true,
	...over,
	manifest: {
		name: "acme/crm",
		url: "https://example.com",
		sdk: ">=1.0.0",
		blocks: {},
		integrations: [
			{
				...toIntegrationEntry({
					name: "acme/crm/hub",
					label: "Acme CRM",
					icon: "data:image/svg+xml,x",
					group: "crm",
					variant: "Acme",
					config: { token: param.secret({ required: true }) },
					connect: () => ({}),
				} as never),
				entry: "dist/integrations/hub.js",
			},
		],
	},
});

afterEach(() => applyPluginVariants(P, "acme/crm", undefined));

describe("GET /integrations/variants", () => {
	it("lists the built-in groups with their labels, variants and order", () => {
		const groups = handleRequest(P);
		expect(groups.map((g) => [g.group, g.label, g.variants.length])).toEqual([
			["database", "Databases", 3],
			["kv", "Key Value store", 2],
			["ai", "AI", 5],
			["baas", "Backend as a Service", 0],
			["observability", "Observability", 2],
			["queue", "Message queues", 4],
			["mcp", "MCP servers", 1],
		]);
		expect(groups[0]!.variants.map((v) => [v.variant, v.conditionEditor])).toEqual([
			["PostgreSQL", "sql"],
			["MongoDB", "js"],
			["MySQL", "sql"],
		]);
		expect(groups.every((g) => g.builtIn && g.variants.every((v) => v.builtIn))).toBe(true);
	});

	it("includes an approved plugin's group for its own project only, with its plugin and namespace", () => {
		applyPluginVariants(P, "acme/crm", pluginRow() as never);
		expect(handleRequest(P).at(-1)).toMatchObject({
			group: "acme/crm",
			label: "acme/crm",
			builtIn: false,
			namespace: "acme",
			variants: [
				{ variant: "Acme", label: "Acme CRM", builtIn: false, plugin: "acme/crm", namespace: "acme" },
			],
		});
		expect(handleRequest(OTHER).some((g) => g.group === "acme/crm")).toBe(false);
	});

	it("hides a plugin switched off in both environments, and refuses to create one", () => {
		applyPluginVariants(P, "acme/crm", pluginRow({ devEnabled: false, prodEnabled: false }) as never);
		expect(handleRequest(P).some((g) => g.group === "acme/crm")).toBe(false);
		expect(() => variantConfigSchema("acme/crm", "Acme", P, { create: true })).toThrow(
			"belongs to a disabled plugin",
		);
		// existing rows still validate on update
		expect(variantConfigSchema("acme/crm", "Acme", P).safeParse({ token: "cfg:T" }).success).toBe(true);
		// on in one environment: still listed
		applyPluginVariants(P, "acme/crm", pluginRow({ prodEnabled: false }) as never);
		expect(handleRequest(P).some((g) => g.group === "acme/crm")).toBe(true);
	});

	it("drops the variants of a plugin that is pending, rejected or removed", () => {
		applyPluginVariants(P, "acme/crm", pluginRow() as never);
		applyPluginVariants(P, "acme/crm", { ...pluginRow(), approval: "pending" } as never);
		expect(integrationRegistry.get("acme/crm", "Acme", P)).toBeUndefined();
		applyPluginVariants(P, "acme/crm", pluginRow() as never);
		applyPluginVariants(P, "acme/crm", undefined);
		expect(integrationRegistry.get("acme/crm", "Acme", P)).toBeUndefined();
	});
});

describe("pluginVariantUnusable: what the compiler names instead of the config", () => {
	it("says the plugin is disabled, per environment, and nothing for a usable or built-in kind", () => {
		applyPluginVariants(P, "acme/crm", pluginRow({ devEnabled: false, prodEnabled: false }) as never);
		expect(pluginVariantUnusable(P, "acme/crm", "Acme", "production")).toBe("plugin acme/crm is disabled");
		applyPluginVariants(P, "acme/crm", pluginRow({ prodEnabled: false }) as never);
		expect(pluginVariantUnusable(P, "acme/crm", "Acme", "production")).toBe(
			"plugin acme/crm is disabled in production",
		);
		expect(pluginVariantUnusable(P, "acme/crm", "Acme", "development")).toBeUndefined();
		expect(pluginVariantUnusable(P, "kv", "Redis", "production")).toBeUndefined();
		expect(pluginVariantUnusable(OTHER, "acme/crm", "Acme", "production")).toBeUndefined();
	});
});

describe("variantConfigSchema", () => {
	it("answers an unknown variant with a 400 that names it", () => {
		expect(() => variantConfigSchema("database", "Oracle")).toThrow(BadRequestError);
		expect(() => variantConfigSchema("database", "Oracle")).toThrow('"Oracle"');
		expect(variantConfigSchema("observability", "Open Telemetry Logs")).toBe(
			variantConfigSchema("observability", "Open Telemetry"),
		);
	});

	it("validates a plugin variant from its manifest: a secret must be a cfg: reference", () => {
		applyPluginVariants(P, "acme/crm", pluginRow() as never);
		const schema = variantConfigSchema("acme/crm", "Acme", P);
		expect(schema.safeParse({ token: "cfg:T" }).success).toBe(true);
		expect(schema.safeParse({ token: "plain" }).success).toBe(false);
		expect(() => variantConfigSchema("acme/crm", "Acme", OTHER)).toThrow(BadRequestError);
	});
});
