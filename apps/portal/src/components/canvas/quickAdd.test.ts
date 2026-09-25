import { expect, test } from "bun:test";
import { createHistoryStack } from "./history/historyStack";
import type { CanvasSnapshot } from "./history/useCanvasHistory";
import {
	applyQuickAdd,
	canInsertIntoEdge,
	continueHandle,
	placeBeside,
	QUICK_ADD_GAP,
	quickAdd,
	type Rect,
} from "./quickAdd";
import type { BlockEdge, BlockNode } from "./types";

const box: Rect = { x: 0, y: 0, width: 200, height: 80 };

function node(id: string, type = "consolelog", x = 0, y = 0, data = {}): BlockNode {
	return { id, type, position: { x, y }, data, measured: { width: 200, height: 80 } };
}

function link(source: string, kind: string, target: string): BlockEdge {
	return {
		id: `${source}->${target}`,
		source,
		sourceHandle: `${source}-${kind}`,
		target,
		targetHandle: `${target}-target`,
	};
}

test("placeBeside puts the block on the handle's side, one gap away", () => {
	expect(placeBeside(box, "source", [])).toEqual({ x: 200 + QUICK_ADD_GAP, y: 0 });
	expect(placeBeside(box, "executor", [])).toEqual({ x: 0, y: -80 - QUICK_ADD_GAP });
	expect(placeBeside(box, "orchestrate", []).y).toBeLessThan(0);
	// success/failure split up and down so the siblings don't stack
	expect(placeBeside(box, "success", []).y).toBeLessThan(0);
	expect(placeBeside(box, "failure", []).y).toBeGreaterThan(0);
});

test("placeBeside nudges past a block already in the spot", () => {
	const taken = { ...box, x: 200 + QUICK_ADD_GAP };
	const spot = placeBeside(box, "source", [box, taken]);
	expect(spot.x).toBe(taken.x);
	expect(spot.y).toBeGreaterThanOrEqual(80);
});

test("inserted blocks continue through `source`, terminals can't be inserted", () => {
	expect(continueHandle("forloop")).toBe("source");
	expect(continueHandle("if")).toBe("success");
	expect(canInsertIntoEdge("response")).toBe(false);
	expect(canInsertIntoEdge("entrypoint")).toBe(false);
	expect(canInsertIntoEdge("consolelog")).toBe(true);
});

test("add from a handle: block + edge in one history entry", () => {
	const nodes = [node("a")];
	const stack = createHistoryStack<CanvasSnapshot>();
	let graph: CanvasSnapshot = { nodes, edges: [] };
	const result = quickAdd(nodes, [], { kind: "handle", nodeId: "a", handle: "source" }, node("n"));
	if (!result) throw new Error("no result");
	applyQuickAdd(result, {
		commit: () => stack.commit(graph),
		markUpserted: () => {},
		markDeleted: () => {},
		setGraph: (n, e) => {
			graph = { nodes: n, edges: e };
		},
	});
	expect(stack.sizes()).toEqual({ past: 1, future: 0 });
	expect(graph.edges).toMatchObject([{ sourceHandle: "a-source", target: "n", targetHandle: "n-target" }]);
	expect(stack.undo(graph)?.edges).toEqual([]);
});

test("insert into an edge: old edge replaced by two, one history entry, tracked", () => {
	const nodes = [node("a"), node("b", "consolelog", 600)];
	const edges = [link("a", "source", "b")];
	const stack = createHistoryStack<CanvasSnapshot>();
	const marked: string[] = [];
	const result = quickAdd(nodes, edges, { kind: "edge", edgeId: "a->b" }, node("n", "if"));
	if (!result) throw new Error("no result");
	applyQuickAdd(result, {
		commit: () => stack.commit({ nodes, edges }),
		markUpserted: (kind, ids) => marked.push(...[...ids].map((id) => `+${kind}:${id}`)),
		markDeleted: (kind, ids) => marked.push(...[...ids].map((id) => `-${kind}:${id}`)),
		setGraph: () => {},
	});
	expect(stack.sizes()).toEqual({ past: 1, future: 0 });
	expect(result.edges.map((e) => [e.sourceHandle, e.targetHandle])).toEqual([
		["a-source", "n-target"],
		["n-success", "b-target"],
	]);
	expect(marked).toContain("-edges:a->b");
	expect(marked).toContain("+blocks:n");
	const placed = result.nodes.find((item) => item.id === "n");
	expect(placed?.position.x).toBeGreaterThan(200);
	expect(placed?.position.x).toBeLessThan(600);
});

test("insert into a switch case keeps the branch's slot and condition", () => {
	const sw = node("s", "switch", 0, 0, {
		order: ["b", "c"],
		conditions: { b: "js: return 1;", c: "x" },
		defaultCase: "b",
	});
	const nodes = [sw, node("b", "consolelog", 600), node("c", "consolelog", 600, 200)];
	const edges = [link("s", "case", "b"), link("s", "case", "c")];
	const result = quickAdd(nodes, edges, { kind: "edge", edgeId: "s->b" }, node("n"));
	const data = result?.nodes.find((item) => item.id === "s")?.data;
	expect(data).toMatchObject({
		order: ["n", "c"],
		conditions: { n: "js: return 1;", c: "x" },
		defaultCase: "n",
	});
	expect(result?.upsertedBlocks).toContain("s");
});

test("a context that went stale while the picker was open does nothing", () => {
	expect(quickAdd([], [], { kind: "edge", edgeId: "gone" }, node("n"))).toBeNull();
	expect(quickAdd([], [], { kind: "handle", nodeId: "gone", handle: "source" }, node("n"))).toBeNull();
});
