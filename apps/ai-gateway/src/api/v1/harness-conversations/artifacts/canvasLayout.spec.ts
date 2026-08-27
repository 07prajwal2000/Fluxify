import { describe, expect, it } from "bun:test";
import {
	assertCanvasUnchanged,
	canvasDigest,
	formattedCanvasChanges,
} from "./canvasLayout";
import type { CanvasItems } from "./normalize";

describe("formattedCanvasChanges layout anchoring", () => {
	/** A three-block route the user has already arranged on screen. */
	const arranged: CanvasItems = {
		blocks: [
			{ id: "e1", type: "entrypoint", data: {}, position: { x: 900, y: 300 } },
			{ id: "j1", type: "jsrunner", data: { value: "return 1" }, position: { x: 1132, y: 300 } },
			{ id: "r1", type: "response", data: { httpCode: "200" }, position: { x: 1364, y: 300 } },
		],
		edges: [
			{ id: "x1", from: "e1", to: "j1", fromHandle: "e1-source", toHandle: "j1-target" },
			{ id: "x2", from: "j1", to: "r1", fromHandle: "j1-source", toHandle: "r1-target" },
		],
	};

	it("keeps untouched blocks where the user put them when the agent re-emits the canvas", async () => {
		// The contract asks for NEW blocks in `blocks`, but an agent editing one
		// field routinely restates the whole canvas — with coordinates it invented
		// for a canvas it cannot see. Every block then read as "changed", the
		// layout had nothing to anchor on, and the whole route jumped to 0,0.
		const out = await formattedCanvasChanges(
			{
				blocks: [
					{ id: "e1", blockType: "entrypoint", data: {}, position: { x: 0, y: 0 }, connections: [{ blockId: "j1", handle: "source" }] },
					{ id: "j1", blockType: "jsrunner", data: { value: "return 2" }, position: { x: 200, y: 0 }, connections: [{ blockId: "r1", handle: "source" }] },
					{ id: "r1", blockType: "response", data: { httpCode: "200" }, position: { x: 400, y: 0 }, connections: [] },
				],
			},
			arranged,
		);

		const at = (id: string) => out.changes.blocks.find((b) => b.id === id)?.position;
		expect(at("e1")).toEqual({ x: 900, y: 300 });
		expect(at("r1")).toEqual({ x: 1364, y: 300 });
		// The one block it actually edited keeps its new configuration.
		expect(out.changes.blocks.find((b) => b.id === "j1")?.data).toMatchObject({
			value: "return 2",
		});
	});

	it("still re-flows around a genuinely new block", async () => {
		const out = await formattedCanvasChanges(
			{
				blocks: [
					{ id: "new_1", blockType: "consolelog", data: { message: "hi" }, position: { x: 0, y: 0 }, connections: [{ blockId: "r1", handle: "source" }] },
				],
				canvasChanges: [
					{ type: "edge_swap", data: { fromEdge: "j1", fromHandle: "source", toEdge: "new_1" } },
				],
			},
			arranged,
		);

		const placed = out.changes.blocks.find((b) => b.type === "consolelog");
		// Laid out relative to the arrangement it was inserted into, not at 0,0.
		expect(placed?.position.x).toBeGreaterThan(900);
	});
});

describe("canvasDigest", () => {
	const canvas = (data: unknown, x = 0): CanvasItems => ({
		blocks: [
			{ id: "e1", type: "entrypoint", data: {}, position: { x, y: 0 } },
			{ id: "j1", type: "jsrunner", data, position: { x: x + 200, y: 0 } },
		],
		edges: [{ id: "x1", from: "e1", to: "j1", fromHandle: "e1-source", toHandle: "j1-target" }],
	});

	// Dragging a block is not an edit an agent's delta can collide with, and a
	// conflict raised over one is indistinguishable from a bug to the user.
	it("ignores positions and storage order", () => {
		const moved = canvas({ value: "return 1" }, 900);
		moved.blocks.reverse();
		expect(canvasDigest(moved)).toBe(canvasDigest(canvas({ value: "return 1" })));
	});

	it("changes when a block is reconfigured", () => {
		expect(canvasDigest(canvas({ value: "return 2" }))).not.toBe(
			canvasDigest(canvas({ value: "return 1" })),
		);
	});

	it("changes when an edge is rewired", () => {
		const rewired = canvas({});
		rewired.edges[0].to = "r1";
		expect(canvasDigest(rewired)).not.toBe(canvasDigest(canvas({})));
	});
});

describe("assertCanvasUnchanged", () => {
	const live: CanvasItems = {
		blocks: [{ id: "j1", type: "jsrunner", data: { value: "user edit" }, position: { x: 0, y: 0 } }],
		edges: [],
	};
	const stale = { baseCanvasDigest: "0".repeat(32) };
	const fresh = { baseCanvasDigest: canvasDigest(live) };

	// Applying re-merges the delta into the live canvas, so a block the user has
	// since reconfigured is upserted back to what the agent read — their edit gone,
	// with nothing on screen to say it happened.
	it("refuses a delta built against a canvas that has since moved", () => {
		expect(() => assertCanvasUnchanged({}, stale, live)).toThrow(/edited after/);
	});

	it("allows one built against the canvas as it stands", () => {
		expect(() => assertCanvasUnchanged({}, fresh, live)).not.toThrow();
	});

	// A canvas riding along with a route this run creates records no digest, and
	// artifacts built before this check existed have none either.
	it("allows a payload that recorded no digest", () => {
		expect(() => assertCanvasUnchanged({}, {}, live)).not.toThrow();
	});

	// The second apply finds the artifact's own changes in the canvas. That is not
	// somebody else's edit, and a partial-failure retry has to stay possible.
	it("allows a re-apply of an artifact that already landed", () => {
		expect(() =>
			assertCanvasUnchanged({ appliedAt: new Date() }, stale, live),
		).not.toThrow();
	});
});
