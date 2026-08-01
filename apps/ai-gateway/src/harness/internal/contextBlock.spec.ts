import { describe, expect, it } from "bun:test";
import { buildContextBlock } from "./contextBlock";
import type { DbService } from "./dbService";

const dbWith = (over: Partial<DbService> = {}) =>
	({
		getRouteDetails: async () => null,
		getRouteCanvas: async () => null,
		getCustomBlockCanvas: async () => null,
		...over,
	}) as unknown as DbService;

describe("buildContextBlock", () => {
	it("produces nothing when there is no location", async () => {
		const out = await buildContextBlock(dbWith(), "proj-1", undefined);
		expect(out).toBeUndefined();
	});

	it("produces nothing when there is no projectId", async () => {
		const out = await buildContextBlock(dbWith(), undefined, {
			where: "route-canvas",
			id: "route-1",
		});
		expect(out).toBeUndefined();
	});

	it("summarizes a route location with its canvas", async () => {
		const db = dbWith({
			getRouteDetails: async () => ({
				method: "GET",
				path: "/tasks",
				name: "List tasks",
			}),
			getRouteCanvas: async () => [
				{ id: "blk_1", blockType: "http_request", connections: [{ blockId: "blk_2" }] },
				{ id: "blk_2", blockType: "js_code", connections: [] },
			],
		});

		const out = await buildContextBlock(db, "proj-1", {
			where: "route-canvas",
			id: "route-1",
		});

		expect(out).toContain("## Current context");
		expect(out).toContain("route `route-1`");
		expect(out).toContain("GET /tasks");
		expect(out).toContain("List tasks");
		expect(out).toContain("2 blocks");
		expect(out).toContain("blk_1(http_request)->blk_2");
		expect(out).toContain("blk_2(js_code)");
		expect(out).toContain("Do NOT call find_resource");
	});

	it("returns nothing when the route can no longer be found", async () => {
		const out = await buildContextBlock(dbWith(), "proj-1", {
			where: "route-canvas",
			id: "gone",
		});
		expect(out).toBeUndefined();
	});

	it("summarizes a custom-block location with its canvas", async () => {
		const db = dbWith({
			getCustomBlockCanvas: async () => [
				{ id: "blk_1", blockType: "entrypoint", connections: [] },
			],
		});

		const out = await buildContextBlock(db, "proj-1", {
			where: "custom-block-canvas",
			id: "cb-1",
		});

		expect(out).toContain("custom block `cb-1`");
		expect(out).toContain("1 blocks");
		expect(out).toContain("blk_1(entrypoint)");
	});

	it("returns nothing when the custom block canvas can't be found", async () => {
		const out = await buildContextBlock(dbWith(), "proj-1", {
			where: "custom-block-canvas",
			id: "gone",
		});
		expect(out).toBeUndefined();
	});

	it("swallows db errors and returns nothing", async () => {
		const db = dbWith({
			getRouteDetails: async () => {
				throw new Error("db down");
			},
		});
		const out = await buildContextBlock(db, "proj-1", {
			where: "route-canvas",
			id: "route-1",
		});
		expect(out).toBeUndefined();
	});
});
