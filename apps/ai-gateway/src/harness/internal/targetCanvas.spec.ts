import { describe, expect, it } from "bun:test";
import { buildTargetCanvasContext } from "./targetCanvas";
import type { DbService } from "./dbService";
import { AgentNode, type Task } from "../types";

const task = (dependsOnAgentId: string[], description = "Wire it up."): Task => ({
	id: "build-1",
	title: "Build profiles route",
	description,
	dependsOnAgentId,
	status: "running",
	assignedAgentNode: AgentNode.BLOCK_BUILDER,
});

const CANVAS = [
	{
		id: "b1",
		blockType: "response",
		blockName: "Reply",
		data: { status: 200 },
		position: { x: 336, y: 48 },
		connections: [],
	},
];

/** Counts what the agent would otherwise have spent tool calls on. */
function stubDb(routes: Record<string, unknown> = { "route-9": { id: "route-9" } }) {
	const calls: string[] = [];
	return {
		calls,
		db: {
			async getRouteDetails(_p: string, id: string) {
				calls.push(`details:${id}`);
				return routes[id] ?? null;
			},
			async getRouteCanvas(_p: string, id: string) {
				calls.push(`canvas:${id}`);
				return routes[id] ? CANVAS : null;
			},
			async getCustomBlockCanvas(_p: string, id: string) {
				calls.push(`cbCanvas:${id}`);
				return CANVAS;
			},
			async findCustomBlocks(_p: string, id: string) {
				calls.push(`cb:${id}`);
				return [{ id, name: "audit", label: "Audit", inputParams: [] }];
			},
		} as unknown as DbService,
	};
}

describe("buildTargetCanvasContext", () => {
	it("prefetches the canvas of a route a dependency already created", async () => {
		const { db, calls } = stubDb();
		const out = await buildTargetCanvasContext(
			db,
			{ projectId: "p1" },
			task(["route-1"]),
			{ "route-1": { action: "create", routeId: "route-9" } },
		);

		expect(out).toContain("## Target canvas");
		expect(out).toContain("targetId: route-9");
		// the canvas itself, with positions — this is what removes the round trips
		expect(out).toContain("response b1");
		expect(out).toContain("@336,48");
		expect(out).toContain("Do NOT call find_resource");
		expect(calls).toContain("canvas:route-9");
	});

	// The old context asserted `canvas: []` for anything a dependency created,
	// which is a lie the moment that artifact is applied — the agent then wrote a
	// second copy of the blocks that were already there.
	it("says the target is not applied yet only when it really is not", async () => {
		const { db } = stubDb({});
		const out = await buildTargetCanvasContext(
			db,
			{ projectId: "p1" },
			task(["route-1"]),
			{ "route-1": { action: "create", routeId: "route-9" } },
		);

		expect(out).toContain("targetId: route-9");
		expect(out).toContain("does not exist in the database yet");
		expect(out).toContain("Do NOT call find_resource");
	});

	it("resolves a target from an inventory id quoted in the task", async () => {
		const { db, calls } = stubDb();
		const out = await buildTargetCanvasContext(
			db,
			{
				projectId: "p1",
				projectInventory: [
					{ type: "route", id: "route-9", identifier: "GET /a", label: "A" },
					{ type: "route", id: "route-8", identifier: "GET /b", label: "B" },
				],
			},
			task([], "Add a log block to route-9."),
			{},
		);

		expect(out).toContain("targetId: route-9");
		expect(calls).toContain("canvas:route-9");
	});

	it("leaves an ambiguous target to the model", async () => {
		const { db, calls } = stubDb();
		const out = await buildTargetCanvasContext(
			db,
			{
				projectId: "p1",
				projectInventory: [
					{ type: "route", id: "route-9", identifier: "GET /a", label: "A" },
					{ type: "route", id: "route-8", identifier: "GET /b", label: "B" },
				],
			},
			task([], "Copy route-9 into route-8."),
			{},
		);

		expect(out).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it("does not restate the canvas the user was already viewing", async () => {
		const { db, calls } = stubDb();
		const out = await buildTargetCanvasContext(
			db,
			{ projectId: "p1", location: { where: "route-canvas", id: "route-9" } },
			task(["route-1"]),
			{ "route-1": { action: "update-partial", routeId: "route-9" } },
		);

		expect(out).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it("ignores a dependency that deleted its resource", async () => {
		const { db } = stubDb();
		const out = await buildTargetCanvasContext(db, { projectId: "p1" }, task(["route-1"]), {
			"route-1": { action: "delete", routeId: "route-9" },
		});

		expect(out).toBeUndefined();
	});

	it("follows a prior block builder's chosen target", async () => {
		const { db } = stubDb();
		const out = await buildTargetCanvasContext(db, { projectId: "p1" }, task(["bb-1"]), {
			"bb-1": { status: "success", targetType: "custom_block", targetId: "cb-3" },
		});

		expect(out).toContain("targetType: custom_block");
		expect(out).toContain("targetId: cb-3");
	});
});
