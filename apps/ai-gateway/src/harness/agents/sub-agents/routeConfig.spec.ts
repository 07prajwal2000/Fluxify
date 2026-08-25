import { describe, expect, it } from "bun:test";
import { routeConfigOutputSchema, validateAgentOutput } from "./routeConfig";
import type { GlobalGraphState, SubAgentResult } from "../../types";

const check = (result: SubAgentResult) =>
	validateAgentOutput(result, "t-1", {} as GlobalGraphState);

describe("routeConfig validateAgentOutput", () => {
	it("rejects malformed query-schema wire format before supervision", () => {
		expect(routeConfigOutputSchema.safeParse({
			action: "create",
			data: {
				name: "List Profiles",
				querySchema: { dataType: "object", properties: { item: [] } },
			},
		}).success).toBe(false);
	});

	it("rejects the malformed profile-list query output", () => {
		expect(routeConfigOutputSchema.safeParse({
			action: "create",
			data: {
				name: "List Profiles",
				method: "GET",
				path: "/api/profiles",
				querySchema: {
					dataType: "object",
					properties: {
						item: [{
							key: "page",
							dataType: "int",
							required: "false",
							defaultValue: "1",
							rules: { item: { type: "min", value: "1" } },
						}],
					},
				},
			},
		}).success).toBe(false);
	});

	it("rejects nested form body schemas", () => {
		expect(routeConfigOutputSchema.safeParse({ action: "create", data: {
			name: "Upload", acceptedContentTypes: ["multipart/form-data"],
			bodySchema: { dataType: "object", properties: [{ key: "meta", dataType: "object", properties: [] }] },
		} }).success).toBe(false);
	});
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
