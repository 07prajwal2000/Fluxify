import { describe, expect, it } from "bun:test";
import { buildContextBlock, locationFromResourceChips } from "./contextBlock";
import type { DbService } from "./dbService";

const chip = (type: string, id: string) =>
	`:resource{type="${type}" identifier="${id}" name="Users"}`;

describe("locationFromResourceChips", () => {
	it("targets the resource the user mentioned", () => {
		expect(
			locationFromResourceChips(`add pagination to ${chip("route", "r1")}`, undefined),
		).toEqual({ where: "route-canvas", id: "r1" });
		expect(
			locationFromResourceChips(chip("custom_block", "cb1"), undefined),
		).toEqual({ where: "custom-block-canvas", id: "cb1" });
	});

	// The open canvas stays authoritative; a mention alongside it may be a
	// reference rather than the target.
	it("never displaces an open canvas", () => {
		const open = { where: "route-canvas", id: "open" } as const;
		expect(locationFromResourceChips(chip("route", "r1"), open)).toEqual(open);
	});

	it("ignores two mentions, which is a real choice", () => {
		const query = `${chip("route", "r1")} and ${chip("route", "r2")}`;
		expect(locationFromResourceChips(query, undefined)).toBeUndefined();
	});

	it("ignores resources that have no canvas", () => {
		expect(
			locationFromResourceChips(chip("integration", "i1"), undefined),
		).toBeUndefined();
	});

	it("does nothing without a query", () => {
		expect(locationFromResourceChips(undefined, undefined)).toBeUndefined();
	});
});

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
		expect(out).toContain("targetId: route-1");
		expect(out).toContain('"method":"GET"');
		expect(out).toContain('"querySchema":{"dataType":"object"');
		// The canvas is a block listing, not JSON — the agent already holds
		// every block type's contract, so the shape around the values is waste.
		expect(out).toContain("http_request blk_1");
		expect(out).toContain("-> blk_2");
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

		expect(out).toContain("targetId: cb-1");
		expect(out).toContain("entrypoint blk_1");
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
