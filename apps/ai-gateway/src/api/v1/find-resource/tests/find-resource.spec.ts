import { describe, it, expect, spyOn } from "bun:test";
import {
	DbService,
	idLookups,
	INTEGER,
	toPrefixTsQuery,
	UUID,
} from "../../../../harness/internal/dbService";
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

describe("idLookups", () => {
	it("matches an id the text search can never find", () => {
		// `toPrefixTsQuery` turns this into hex prefix terms and compares them
		// against the *name* column, so the id the planner handed the agent is
		// the one input guaranteed to miss.
		const id = "019f8c3d-1a2b-7c4d-8e5f-6a7b8c9d0e1f";
		expect(toPrefixTsQuery(id)).not.toContain(id);
		expect(idLookups([id], UUID)).toEqual([id]);
		expect(idLookups(["users", "auth"])).toEqual(["users", "auth"]);
	});

	it("drops keywords a typed id column would reject", () => {
		// Postgres errors on `uuid = 'auth'`, and the caller turns any error into
		// an empty result — one ordinary word would blank the whole search.
		expect(idLookups(["auth", "019f8c3d-1a2b-7c4d-8e5f-6a7b8c9d0e1f"], UUID))
			.toEqual(["019f8c3d-1a2b-7c4d-8e5f-6a7b8c9d0e1f"]);
		expect(idLookups(["DATABASE_URL", "42"], INTEGER)).toEqual(["42"]);
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
		const customBlocks = spyOn(DbService.prototype, "findCustomBlocks").mockResolvedValue([
			{
				type: "custom_block",
				id: "cb1",
				name: "user_defined.project.notify",
				label: "Notify",
				inputParams: [{ name: "message", type: "text_input", label: "Message" }],
			},
		] as never);

		const result = await handleRequest("proj1", "users");

		// Whole phrase, one term — see the note in the service.
		for (const spy of [routes, integrations, appConfigs, customBlocks]) {
			expect(spy).toHaveBeenCalledWith("proj1", "users");
		}
		expect(result.query).toBe("users");
		expect(result.results.map((r) => r.type)).toEqual([
			"route",
			"integration",
			"custom_block",
		]);
		// the caller contract travels with the block — an id alone says nothing
		// about how to invoke it
		expect(result.results.at(-1)?.inputParams).toHaveLength(1);
	});

	it("rejects a blank query instead of scanning every table", () => {
		expect(queryParamsSchema.safeParse({ q: "   " }).success).toBe(false);
		expect(queryParamsSchema.safeParse({ q: "users" }).success).toBe(true);
	});
});
