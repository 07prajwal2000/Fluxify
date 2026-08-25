import { describe, expect, it } from "bun:test";
import { validateAgentOutput } from "./routeConfig";
import type { GlobalGraphState, SubAgentResult } from "../../types";

const check = (result: SubAgentResult) =>
	validateAgentOutput(result, "t-1", {} as GlobalGraphState);

describe("routeConfig validateAgentOutput", () => {
	it("rejects a create that forgot the route name", () => {
		expect(
			check({ action: "create", data: { method: "POST", path: "/orders" } }),
		).toContain("data.name");
		// Whitespace is not a name either.
		expect(
			check({ action: "create", data: { name: "  ", path: "/orders" } }),
		).toContain("data.name");
	});

	it("accepts a create that names the route", () => {
		expect(
			check({
				action: "create",
				data: { name: "Create Order", method: "POST", path: "/orders" },
			}),
		).toBeNull();
	});

	it("does not force a name on update-partial or delete", () => {
		expect(
			check({ action: "update-partial", routeId: "r-1", data: { path: "/o" } }),
		).toBeNull();
		expect(check({ action: "delete", routeId: "r-1" })).toBeNull();
	});

	it("requires a complete, supported path params schema", () => {
		expect(
			check({ action: "create", data: { name: "Get User", path: "/users/:id" } }),
		).toContain("paramsSchema");
		expect(
			check({
				action: "create",
				data: {
					name: "Get User",
					path: "/users/:id",
					paramsSchema: { dataType: "object", properties: [{ key: "id", dataType: "arr", required: true }] },
				},
			}),
		).toContain("must use one of");
	});

	it("rejects unsupported query schema shapes", () => {
		expect(
			check({
				action: "create",
				data: { name: "List Users", path: "/users", querySchema: { dataType: "arr" } },
			}),
		).toContain("dataType \"object\"");
	});
});
