import { describe, expect, it } from "bun:test";
import { renderProjectInventory } from "./projectInventory";

describe("renderProjectInventory", () => {
	it("renders a compact, fenced inventory with exact IDs", () => {
		const out = renderProjectInventory([
			{
				type: "route",
				id: "route-1",
				identifier: "GET /users",
				label: "List users",
			},
			{
				type: "app_config",
				id: "7",
				identifier: "DATABASE_URL",
				label: "Database connection",
			},
		]);

		expect(out).toContain("Relevant project inventory");
		expect(out).toContain("<tool_result name=\"project_inventory\" untrusted=\"true\">");
		expect(out).toContain("GET /users");
		expect(out).toContain("route-1");
		expect(out).toContain("Do NOT call find_resource merely to rediscover");
	});

	it("adds no prompt content when inventory has no relevant entries", () => {
		expect(renderProjectInventory([])).toBe("");
		expect(renderProjectInventory(undefined)).toBe("");
	});
});
