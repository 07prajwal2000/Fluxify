import { describe, expect, it } from "bun:test";
import { createGetCustomBlockSchemasTool } from "./getBlockSchemas";
import type { DbService } from "../internal/dbService";

describe("get_custom_block_schemas", () => {
	it("returns only custom block contracts", async () => {
		const queried: string[] = [];
		const tool = createGetCustomBlockSchemasTool(
			{
				getCustomBlockInputParams: async (_projectId: string, name: string) => {
					queried.push(name);
					return name === "audit"
						? [{ name: "level", type: "dropdown", options: [{ value: "info" }] }]
						: undefined;
				},
			} as unknown as DbService,
			"project-1",
		);

		const result = await tool.invoke({ customBlockNames: ["custom:audit"] });

		expect(result).toContain("### Custom Block: audit");
		expect(result).toContain("level: \"info\"");
		expect(queried).toEqual(["audit"]);
	});

	it("does not expose a built-in schema lookup path", () => {
		const tool = createGetCustomBlockSchemasTool(
			{} as DbService,
			"project-1",
		);

		expect(tool.name).toBe("get_custom_block_schemas");
		expect(tool.description).toContain("custom blocks only");
		expect(tool.description).toContain("already preloaded");
	});
});
