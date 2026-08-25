import { describe, expect, it } from "bun:test";
import { buildContextBlock } from "./contextBlock";
import type { DbService } from "./dbService";

const dbWith = (over: Partial<DbService> = {}) =>
	({
		getRouteDetails: async () => null,
		getRouteCanvas: async () => null,
		getCustomBlockCanvas: async () => null,
		findCustomBlocks: async () => [],
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

	it("preloads editable route configuration and canvas", async () => {
		const db = dbWith({
			getRouteDetails: async () => ({
				id: "route-1",
				method: "GET",
				path: "/tasks",
				name: "List tasks",
				querySchema: { dataType: "object", properties: [] },
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
		expect(out).toContain('"targetId":"route-1"');
		expect(out).toContain('"method":"GET"');
		expect(out).toContain('"querySchema":{"dataType":"object"');
		expect(out).toContain('"id":"blk_1"');
		expect(out).toContain('"connections":[{"blockId":"blk_2"}]');
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
			findCustomBlocks: async () => [
				{
					type: "custom_block",
					id: "cb-1",
					name: "user_defined.project.notify",
					label: "Notify",
					inputParams: [{ name: "message", type: "text_input" }],
				},
			],
		});

		const out = await buildContextBlock(db, "proj-1", {
			where: "custom-block-canvas",
			id: "cb-1",
		});

		expect(out).toContain('"targetId":"cb-1"');
		expect(out).toContain('"id":"blk_1"');
		// the caller contract is what an agent editing this canvas writes against
		expect(out).toContain("\"name\":\"message\"");
		expect(out).toContain("Notify");
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
