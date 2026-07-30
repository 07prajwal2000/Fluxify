import { expect, test } from "bun:test";
import type { CanvasBlock, CanvasEdge, CanvasGraph } from "../types";
import type { ChangeSet } from "./changeTracker";
import { repairSavePayload, saveWithDoctor } from "./saveDoctor";

const block = (id: string): CanvasBlock => ({
	id,
	type: "consolelog",
	data: {},
	position: { x: 0, y: 0 },
});

const edge = (id: string, from: string, to: string): CanvasEdge => ({
	id,
	from,
	to,
	fromHandle: `${from}-source`,
	toHandle: `${to}-target`,
});

const changeSet = (
	blocks: [string, "upsert" | "delete"][],
	edges: [string, "upsert" | "delete"][] = [],
): ChangeSet => ({ blocks: new Map(blocks), edges: new Map(edges) });

test("stale deletes are dropped", () => {
	const graph: CanvasGraph = { blocks: [], edges: [] };
	const server: CanvasGraph = { blocks: [], edges: [] };

	const { payload, notes } = repairSavePayload(
		graph,
		changeSet([["gone", "delete"]], [["goneEdge", "delete"]]),
		server,
	);

	expect(payload.actionsToPerform.blocks).toEqual([]);
	expect(payload.actionsToPerform.edges).toEqual([]);
	expect(notes).toHaveLength(2);
});

test("an edge's unsaved blocks are pulled into the payload", () => {
	const graph: CanvasGraph = {
		blocks: [block("a"), block("b")],
		edges: [edge("e1", "a", "b")],
	};
	// The server has neither block: only the edge was tracked.
	const server: CanvasGraph = { blocks: [], edges: [] };

	const { payload, notes } = repairSavePayload(graph, changeSet([], [["e1", "upsert"]]), server);

	expect(payload.actionsToPerform.blocks).toEqual([
		{ id: "a", action: "upsert" },
		{ id: "b", action: "upsert" },
	]);
	expect(payload.actionsToPerform.edges).toEqual([{ id: "e1", action: "upsert" }]);
	expect(notes).toHaveLength(2);
});

test("an edge whose blocks are gone for good is dropped", () => {
	const graph: CanvasGraph = { blocks: [], edges: [edge("e1", "a", "b")] };
	const server: CanvasGraph = { blocks: [], edges: [] };

	const { payload, notes } = repairSavePayload(graph, changeSet([], [["e1", "upsert"]]), server);

	expect(payload.actionsToPerform.edges).toEqual([]);
	expect(notes[0]).toContain("do not exist");
});

test("server edges hanging off a deleted block are deleted too", () => {
	const graph: CanvasGraph = { blocks: [block("b")], edges: [] };
	const server: CanvasGraph = {
		blocks: [block("a"), block("b")],
		edges: [edge("e1", "a", "b")],
	};

	const { payload } = repairSavePayload(graph, changeSet([["a", "delete"]]), server);

	expect(payload.actionsToPerform.blocks).toEqual([{ id: "a", action: "delete" }]);
	expect(payload.actionsToPerform.edges).toEqual([{ id: "e1", action: "delete" }]);
});

test("a healthy payload that fails rethrows instead of retrying the same body", async () => {
	const graph: CanvasGraph = { blocks: [block("a")], edges: [] };
	let attempts = 0;

	const run = saveWithDoctor({
		graph,
		changes: changeSet([["a", "upsert"]]),
		save: async () => {
			attempts++;
			throw new Error("500 boom");
		},
		loadServerGraph: async () => ({ blocks: [block("a")], edges: [] }),
	});

	await expect(run).rejects.toThrow("500 boom");
	expect(attempts).toBe(1);
});

test("a repairable payload is retried once and reports what was fixed", async () => {
	const graph: CanvasGraph = { blocks: [], edges: [] };
	const attempts: number[] = [];

	const outcome = await saveWithDoctor({
		graph,
		changes: changeSet([["ghostOnServer", "delete"]]),
		save: async (payload) => {
			attempts.push(payload.actionsToPerform.blocks.length);
			if (attempts.length === 1) throw new Error("404 block not found");
		},
		loadServerGraph: async () => ({ blocks: [], edges: [] }),
	});

	expect(attempts).toEqual([1, 0]);
	expect(outcome.repaired).toBe(true);
	expect(outcome.notes).toHaveLength(1);
});

test("a failure the doctor cannot fix surfaces the retry error", async () => {
	const run = saveWithDoctor({
		graph: { blocks: [], edges: [] },
		changes: changeSet([["ghost", "delete"]]),
		save: async () => {
			throw new Error("still broken");
		},
		loadServerGraph: async () => ({ blocks: [], edges: [] }),
	});

	await expect(run).rejects.toThrow("still broken");
});
