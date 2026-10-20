import { expect, test } from "bun:test";
import type { HandleSpec, HandleSpecs } from "@fluxify/blocks/layout";
import { layoutBlocks } from "../layout";
import { acceptsMore, canInsertIntoEdge, continueHandle, placeBeside, quickAdd } from "../quickAdd";
import type { BlockEdge, BlockNode } from "../types";
import { agent } from "./fixtures";

const spec = agent.handles as unknown as HandleSpec;
const specs = { [agent.name]: spec };
const node = (id: string, type: string, x = 0, y = 0): BlockNode =>
	({
		id,
		type,
		position: { x, y },
		data: {},
		measured: { width: type === agent.name ? 220 : 64, height: type === agent.name ? 72 : 64 },
	}) as BlockNode;
const edge = (id: string, source: string, sourceHandle: string, target: string): BlockEdge =>
	({ id, source, sourceHandle, target, targetHandle: `${target}-target` }) as BlockEdge;

test("a body handle takes one edge unless it is allowMultiple; outputs take one", () => {
	expect(acceptsMore("memory", 0, spec)).toBe(true);
	expect(acceptsMore("memory", 1, spec)).toBe(false);
	expect(acceptsMore("tools", 3, spec)).toBe(true);
	expect(acceptsMore("success", 1, spec)).toBe(false);
	// builtin rule is untouched
	expect(acceptsMore("source", 1)).toBe(false);
	expect(acceptsMore("orchestrate", 4)).toBe(true);
});

test("a block lands on the side its handle's corner is on", () => {
	const rect = { x: 0, y: 0, width: 220, height: 72 };
	const below = placeBeside(rect, "tools", [], spec);
	const above = placeBeside(rect, "approval", [], spec);
	const right = placeBeside(rect, "success", [], spec);

	expect(below.y).toBeGreaterThan(rect.height);
	expect(above.y).toBeLessThan(0);
	expect(right.x).toBeGreaterThan(rect.width);
});

test("quick add from a corner handle connects the new block's first input", () => {
	const source = node("a1", agent.name);
	const picked = node("n1", "acme/slack/messages/post");
	const result = quickAdd([source], [], { kind: "handle", nodeId: "a1", handle: "tools" }, picked, {
		...specs,
		[picked.type as string]: { in: ["input"], out: ["source"], body: [] },
	});

	expect(result?.edges.map((e) => [e.sourceHandle, e.targetHandle])).toEqual([["a1-tools", "n1-input"]]);
});

test("a picked block without an input (a trigger) is added unconnected", () => {
	const picked = node("n1", "acme/hooks/on/event");
	const result = quickAdd(
		[node("a1", agent.name)],
		[],
		{ kind: "handle", nodeId: "a1", handle: "tools" },
		picked,
		{ [picked.type as string]: { in: [], out: ["source"], body: [] } },
	);
	expect(result?.nodes).toHaveLength(2);
	expect(result?.edges).toEqual([]);
});

test("a plugin block goes inside a connection through its first input and its way on", () => {
	const type = "acme/slack/messages/post";
	const own: HandleSpec = { in: ["input"], out: ["success", "failure"], body: [] };
	expect(canInsertIntoEdge(type, own)).toBe(true);
	expect(continueHandle(type, own)).toBe("success");
	// terminal, or no input: nothing to splice in
	expect(canInsertIntoEdge(type, { in: ["input"], out: [], body: [] })).toBe(false);
	expect(canInsertIntoEdge(type, { in: [], out: ["source"], body: [] })).toBe(false);

	const result = quickAdd(
		[node("a", "response"), node("b", "response")],
		[edge("e1", "a", "a-source", "b")],
		{ kind: "edge", edgeId: "e1" },
		node("n", type),
		{ [type]: own },
	);
	expect(result?.edges.map((e) => [e.sourceHandle, e.targetHandle])).toEqual([
		["a-source", "n-input"],
		["n-success", "b-target"],
	]);
});

test("format lays out wide blocks with corner handles without overlap, left to right", async () => {
	const nodes = [
		node("e", "entrypoint"),
		node("a1", agent.name),
		node("t1", "acme/slack/messages/post"),
		node("t2", "acme/slack/messages/post"),
		node("n1", "acme/slack/messages/post"),
	];
	const edges = [
		edge("e1", "e", "e-source", "a1"),
		edge("e2", "a1", "a1-tools", "t1"),
		edge("e3", "a1", "a1-tools", "t2"),
		edge("e4", "a1", "a1-success", "n1"),
	];
	const handleSpecs: HandleSpecs = {
		...specs,
		"acme/slack/messages/post": { in: ["target"], out: ["success", "failure"] as ["success", "failure"], body: [] },
	};
	const positions = await layoutBlocks(nodes, edges, { handleSpecs });

	const rects = nodes.map((n) => ({
		id: n.id,
		...positions[n.id]!,
		width: n.measured!.width!,
		height: n.measured!.height!,
	}));
	for (const a of rects)
		for (const b of rects) {
			if (a.id >= b.id) continue;
			const apart =
				a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
			expect(apart).toBe(true);
		}
	const at = (id: string) => positions[id]!;
	expect(at("e").x).toBeLessThan(at("a1").x);
	expect(at("a1").x).toBeLessThan(at("n1").x);
	// the two tool branches do not stack on top of each other
	expect(at("t1").y).not.toBe(at("t2").y);
});
