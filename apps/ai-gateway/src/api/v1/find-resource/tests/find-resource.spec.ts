import { describe, it, expect, spyOn } from "bun:test";
import { DbService, toPrefixTsQuery } from "../../../../harness/internal/dbService";
import handleRequest from "../service";
import { queryParamsSchema } from "../dto";

describe("toPrefixTsQuery", () => {
	it("makes every word a prefix term so partial input matches", () => {
		// `data:*` is what finds DATABASE_URL — plainto_tsquery never would.
		expect(toPrefixTsQuery("data")).toBe("data:*");
		expect(toPrefixTsQuery("get users")).toBe("get:* & users:*");
	});

	it("splits on separators, so a pasted path searches its segments", () => {
		expect(toPrefixTsQuery("/api/users/:id")).toBe("api:* & users:* & id:*");
		expect(toPrefixTsQuery("DATABASE_URL")).toBe("database:* & url:*");
	});

	it("drops operators rather than escaping them — to_tsquery throws on those", () => {
		expect(toPrefixTsQuery("a & b | !c")).toBe("a:* & b:* & c:*");
		expect(toPrefixTsQuery("'\"(")).toBeNull();
		expect(toPrefixTsQuery("   ")).toBeNull();
	});
});

describe("Find Resource Service", () => {
	it("fans one query out to every resource type and flattens the hits", async () => {
		const routes = spyOn(DbService.prototype, "findRoutes").mockResolvedValue([
			{ type: "route", id: "r1", name: "Get Users", path: "/api/users" },
		] as never);
		const integrations = spyOn(DbService.prototype, "findIntegrations").mockResolvedValue([
			{ type: "integration", id: "i1", name: "Main DB", variant: "postgres" },
		] as never);
		const appConfigs = spyOn(DbService.prototype, "findAppConfigs").mockResolvedValue(
			[] as never,
		);

		const result = await handleRequest("proj1", "users");

		// Whole phrase, one term — see the note in the service.
		for (const spy of [routes, integrations, appConfigs]) {
			expect(spy).toHaveBeenCalledWith("proj1", "users");
		}
		expect(result.query).toBe("users");
		expect(result.results.map((r) => r.type)).toEqual(["route", "integration"]);
	});

	it("rejects a blank query instead of scanning every table", () => {
		expect(queryParamsSchema.safeParse({ q: "   " }).success).toBe(false);
		expect(queryParamsSchema.safeParse({ q: "users" }).success).toBe(true);
	});
});
