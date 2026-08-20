import { describe, expect, it } from "bun:test";
import {
	inlineCanvasFor,
	kindLabel,
	parentsOf,
	topoOrder,
	type GraphRow,
} from "./dependencies";

const row = (over: Partial<GraphRow> & { id: string }): GraphRow => ({
	kind: "canvas",
	payload: {},
	...over,
});

/** A run that builds a custom block and a route that invokes it. The route
 *  names the block by name, deep in a canvas, so only the task edge records it. */
const block = row({
	id: "block",
	kind: "custom_block",
	subAgentId: "task-block",
	dependsOn: [],
	payload: { action: "create", customBlockId: "cb-1" },
});
const blockCanvas = row({
	id: "block-canvas",
	subAgentId: "task-block-canvas",
	dependsOn: ["task-block"],
	payload: { targetType: "custom_block", targetId: "cb-1" },
});
const route = row({
	id: "route",
	kind: "route",
	subAgentId: "task-route",
	dependsOn: ["task-block"],
	payload: { action: "create", routeId: "rt-1" },
});
const routeCanvas = row({
	id: "route-canvas",
	subAgentId: "task-route-canvas",
	dependsOn: ["task-route"],
	payload: { targetType: "route", targetId: "rt-1" },
});
const rows = [routeCanvas, route, blockCanvas, block];

describe("parentsOf", () => {
	it("reads the declared task edge", () => {
		// Nothing in the route's payload mentions the custom block — the run's own
		// task graph is the only record that this order matters.
		expect(parentsOf(route, rows).map((r) => r.id)).toEqual(["block"]);
	});

	it("reads the payload link, so a row written before dependsOn still works", () => {
		const legacy = row({
			id: "legacy-canvas",
			payload: { targetType: "route", targetId: "rt-1" },
		});
		expect(parentsOf(legacy, [...rows, legacy]).map((r) => r.id)).toEqual(["route"]);
	});

	it("does not depend on a parent that only edits something already live", () => {
		const existing = row({
			id: "modify",
			kind: "route",
			payload: { action: "update-partial", routeId: "rt-9" },
		});
		const canvas = row({
			id: "canvas",
			payload: { targetType: "route", targetId: "rt-9" },
		});
		expect(parentsOf(canvas, [existing, canvas])).toEqual([]);
	});

	it("never makes a row its own parent", () => {
		const self = row({
			id: "self",
			kind: "route",
			subAgentId: "t",
			dependsOn: ["t"],
			payload: { action: "create", routeId: "rt-1", targetId: "rt-1" },
		});
		expect(parentsOf(self, [self])).toEqual([]);
	});
});

describe("topoOrder", () => {
	it("puts every row after everything it depends on", () => {
		const order = topoOrder(rows).map((r) => r.id);
		expect(order.indexOf("block")).toBeLessThan(order.indexOf("route"));
		expect(order.indexOf("route")).toBeLessThan(order.indexOf("route-canvas"));
		expect(order.indexOf("block")).toBeLessThan(order.indexOf("block-canvas"));
	});

	it("keeps input order for rows with no relationship", () => {
		const a = row({ id: "a", kind: "other" });
		const b = row({ id: "b", kind: "other" });
		expect(topoOrder([b, a]).map((r) => r.id)).toEqual(["b", "a"]);
	});

	it("terminates on a cycle instead of hanging", () => {
		const a = row({ id: "a", subAgentId: "ta", dependsOn: ["tb"] });
		const b = row({ id: "b", subAgentId: "tb", dependsOn: ["ta"] });
		expect(topoOrder([a, b]).map((r) => r.id).sort()).toEqual(["a", "b"]);
	});

	it("loses nothing", () => {
		expect(topoOrder(rows)).toHaveLength(rows.length);
	});
});

describe("inlineCanvasFor", () => {
	it("finds the canvas built for a parent being created", () => {
		expect(inlineCanvasFor(block, rows, new Set())?.id).toBe("block-canvas");
		expect(inlineCanvasFor(route, rows, new Set())?.id).toBe("route-canvas");
	});

	it("leaves a canvas alone once another parent has taken it", () => {
		expect(inlineCanvasFor(route, rows, new Set(["route-canvas"]))).toBeUndefined();
	});

	it("does not inline into a parent that already exists", () => {
		const modify = row({
			id: "modify",
			kind: "route",
			subAgentId: "task-modify",
			payload: { action: "update-partial", routeId: "rt-2" },
		});
		const canvas = row({
			id: "modify-canvas",
			dependsOn: ["task-modify"],
			payload: { targetType: "route", targetId: "rt-2" },
		});
		expect(inlineCanvasFor(modify, [modify, canvas], new Set())).toBeUndefined();
	});
});

describe("kindLabel", () => {
	it("says what a user would say", () => {
		expect(kindLabel("custom_block")).toBe("custom block");
		expect(kindLabel("route")).toBe("route");
	});
});
