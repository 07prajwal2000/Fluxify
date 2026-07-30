import { expect, test } from "bun:test";
import type { CanvasGraph } from "../types";
import { createChangeTracker } from "./changeTracker";
import { buildSavePayload } from "./savePayload";

const known = { blocks: ["b1", "b2"], edges: ["e1"] };

test("a block that never reached the server is not sent as a delete", () => {
	const tracker = createChangeTracker(known);
	tracker.markUpserted("blocks", ["new1"]);
	tracker.markDeleted("blocks", ["new1"]);
	expect(tracker.size()).toBe(0);

	// A block the server does know about is a real delete.
	tracker.markDeleted("blocks", ["b1"]);
	expect(tracker.changes.blocks.get("b1")).toBe("delete");
});

test("blocks and edges are tracked separately, so ids cannot collide", () => {
	const tracker = createChangeTracker({ blocks: ["x"], edges: ["x"] });
	tracker.markUpserted("blocks", ["x"]);
	tracker.markDeleted("edges", ["x"]);
	expect(tracker.changes.blocks.get("x")).toBe("upsert");
	expect(tracker.changes.edges.get("x")).toBe("delete");
});

test("repeated edits to the same block collapse into one entry", () => {
	const tracker = createChangeTracker(known);
	for (let i = 0; i < 100; i++) tracker.markUpserted("blocks", ["b1"]);
	expect(tracker.size()).toBe(1);
});

test("reset adopts the new baseline", () => {
	const tracker = createChangeTracker(known);
	tracker.markDeleted("blocks", ["b1"]);
	tracker.reset({ blocks: ["b9"], edges: [] });
	expect(tracker.size()).toBe(0);
	// b1 is no longer server-known, so deleting it is a no-op now.
	tracker.markDeleted("blocks", ["b1"]);
	expect(tracker.size()).toBe(0);
});

test("the payload carries only the delta, with records for upserts alone", () => {
	const graph: CanvasGraph = {
		blocks: [
			{ id: "b1", type: "consolelog", data: { message: "hi" }, position: { x: 1, y: 2 } },
			{ id: "b2", type: "response", data: {}, position: { x: 3, y: 4 } },
		],
		edges: [{ id: "e2", from: "b1", to: "b2", fromHandle: "b1-source", toHandle: "b2-target" }],
	};

	const tracker = createChangeTracker(known);
	tracker.markUpserted("blocks", ["b1"]); // moved
	tracker.markDeleted("edges", ["e1"]); // removed a saved edge
	tracker.markUpserted("edges", ["e2"]); // added a new one

	const payload = buildSavePayload(graph, tracker.changes);

	expect(payload.actionsToPerform.blocks).toEqual([{ id: "b1", action: "upsert" }]);
	expect(payload.actionsToPerform.edges).toEqual([
		{ id: "e1", action: "delete" },
		{ id: "e2", action: "upsert" },
	]);
	// b2 was untouched, so it is not in the request at all.
	expect(payload.changes.blocks.map((block) => block.id)).toEqual(["b1"]);
	// Deleted ids carry no record.
	expect(payload.changes.edges.map((edge) => edge.id)).toEqual(["e2"]);
});

test("an upsert whose record vanished is dropped instead of half-sent", () => {
	const tracker = createChangeTracker(known);
	tracker.markUpserted("blocks", ["ghost"]);
	const payload = buildSavePayload({ blocks: [], edges: [] }, tracker.changes);
	expect(payload.actionsToPerform.blocks).toEqual([]);
	expect(payload.changes.blocks).toEqual([]);
});
