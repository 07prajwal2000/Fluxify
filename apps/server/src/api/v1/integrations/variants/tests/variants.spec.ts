import { describe, expect, it } from "bun:test";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import { BadRequestError } from "../../../../../errors/badRequestError";
import handleRequest, { variantConfigSchema } from "../service";

describe("GET /integrations/variants", () => {
	it("lists the built-in groups with their labels, variants and order", () => {
		const groups = handleRequest();
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

	it("includes a registered plugin group and variant", () => {
		integrationRegistry.register({
			group: "acme/crm",
			variant: "Acme",
			label: "Acme CRM",
			configSchema: integrationRegistry.require("mcp", "http").configSchema,
		});
		try {
			expect(handleRequest().at(-1)).toMatchObject({
				group: "acme/crm",
				label: "acme/crm",
				builtIn: false,
				variants: [{ variant: "Acme", label: "Acme CRM", builtIn: false, tags: [] }],
			});
		} finally {
			integrationRegistry.unregister("acme/crm", "Acme");
		}
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
});
