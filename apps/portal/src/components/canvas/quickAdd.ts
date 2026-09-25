import { FAN_OUT_HANDLES } from "@fluxify/blocks/layout";
import type { XYPosition } from "@xyflow/react";
import { blockDefinition } from "./blocks/blockCatalog";
import { HANDLE_CONFIG, type HandleKind, handleId } from "./blocks/handles/handleConfig";
import { FLOW_EDGE_TYPE } from "./edges";
import { uuidv7 } from "./ids";
import type { BlockEdge, BlockNode } from "./types";

/**
 * Quick add: a block created from a handle's `+` or dropped into an edge. Pure
 * graph math only — BlockCanvas applies the result as one undo step.
 */

export const QUICK_ADD_GAP = 80;
/** Size assumed for blocks React Flow has not measured yet. */
const FALLBACK_SIZE = { width: 220, height: 72 };

export type Rect = XYPosition & { width: number; height: number };

/** Where the picked block should connect. */
export type QuickAddContext =
	| { kind: "handle"; nodeId: string; handle: HandleKind; at?: XYPosition }
	| { kind: "edge"; edgeId: string };

export function nodeRect(node: BlockNode): Rect {
	return {
		...node.position,
		width: node.measured?.width ?? node.width ?? FALLBACK_SIZE.width,
		height: node.measured?.height ?? node.height ?? FALLBACK_SIZE.height,
	};
}

function overlaps(a: Rect, b: Rect) {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Beside `source`, on the side `handle` sits on, one gap away. Success goes a
 * bit up and failure a bit down so the two siblings don't stack. Collisions
 * push the block along the side (down for left/right, right for top/bottom).
 */
export function placeBeside(source: Rect, handle: HandleKind, others: Rect[]): XYPosition {
	const size = { width: source.width, height: source.height };
	const side = HANDLE_CONFIG[handle].side;
	const shift = handle === "success" ? -1 : handle === "failure" ? 1 : 0;
	const spot: Rect = { ...size, x: source.x, y: source.y };
	if (side === "right") spot.x = source.x + source.width + QUICK_ADD_GAP;
	if (side === "left") spot.x = source.x - QUICK_ADD_GAP - size.width;
	if (side === "top") spot.y = source.y - QUICK_ADD_GAP - size.height;
	if (side === "bottom") spot.y = source.y + source.height + QUICK_ADD_GAP;
	spot.y += shift * (size.height / 2 + QUICK_ADD_GAP / 4);

	const vertical = side === "left" || side === "right";
	// ponytail: capped linear scan, fine for canvas-sized graphs.
	for (let i = 0; i < 50 && others.some((other) => overlaps(spot, other)); i++) {
		if (vertical) spot.y += size.height + QUICK_ADD_GAP / 4;
		else spot.x += size.width + QUICK_ADD_GAP / 4;
	}
	return { x: spot.x, y: spot.y };
}

/** Output kinds of a block type (everything but the inbound socket). */
function outputs(type: string): HandleKind[] {
	return blockDefinition(type).handles.filter((kind) => HANDLE_CONFIG[kind].flow === "source");
}

/** The output an inserted block continues through: `source` if it has one. */
export function continueHandle(type: string): HandleKind | null {
	const kinds = outputs(type);
	return kinds.includes("source") ? "source" : (kinds[0] ?? null);
}

/** Only blocks with an input and an output can sit in the middle of an edge. */
export function canInsertIntoEdge(type: string): boolean {
	return blockDefinition(type).handles.includes("target") && continueHandle(type) !== null;
}

/** Output handles that may take another edge: empty ones, and fan-out ones always. */
export function acceptsMore(handle: HandleKind, connections: number) {
	const max = HANDLE_CONFIG[handle].maxConnections;
	return max === null || connections < max;
}

function edge(
	source: string,
	sourceHandle: string,
	target: string,
	targetHandle: string,
): BlockEdge {
	return { id: uuidv7(), type: FLOW_EDGE_TYPE, source, sourceHandle, target, targetHandle };
}

/** `<nodeId>-<kind>` → kind. */
function kindOf(nodeId: string, handle: string | null | undefined): string {
	return handle?.startsWith(`${nodeId}-`) ? handle.slice(nodeId.length + 1) : "";
}

/** Switch/orchestrator fields that hold branch target ids. */
export function retarget(data: BlockNode["data"], from: string, to: string): BlockNode["data"] {
	const swap = (id: unknown) => (id === from ? to : id);
	const next: Record<string, unknown> = { ...data };
	if (Array.isArray(next.order)) next.order = next.order.map(swap);
	if (next.defaultCase !== undefined) next.defaultCase = swap(next.defaultCase);
	for (const key of ["conditions", "matches"]) {
		const record = next[key];
		if (record && typeof record === "object" && from in record) {
			const { [from]: value, ...rest } = record as Record<string, unknown>;
			next[key] = { ...rest, [to]: value };
		}
	}
	return next as BlockNode["data"];
}

export type QuickAddResult = {
	nodes: BlockNode[];
	edges: BlockEdge[];
	upsertedBlocks: string[];
	upsertedEdges: string[];
	deletedEdges: string[];
};

/**
 * New graph after adding `node` per `context`. Returns null when the context
 * no longer applies (the block or edge was deleted while the picker was open).
 */
export function quickAdd(
	nodes: BlockNode[],
	edges: BlockEdge[],
	context: QuickAddContext,
	node: BlockNode,
): QuickAddResult | null {
	const deselected = nodes.map((item) => (item.selected ? { ...item, selected: false } : item));

	if (context.kind === "handle") {
		const source = nodes.find((item) => item.id === context.nodeId);
		if (!source) return null;
		const position =
			context.at ?? placeBeside(nodeRect(source), context.handle, nodes.map(nodeRect));
		const placed = { ...node, position };
		// No input on the picked block (a trigger) → added, but left unconnected.
		const link =
			blockDefinition(node.type ?? "").handles.includes("target") &&
			edge(source.id, handleId(source.id, context.handle), node.id, handleId(node.id, "target"));
		const added = link ? [link] : [];
		return {
			nodes: [...deselected, placed],
			edges: [...edges, ...added],
			upsertedBlocks: [node.id],
			upsertedEdges: added.map((item) => item.id),
			deletedEdges: [],
		};
	}

	const old = edges.find((item) => item.id === context.edgeId);
	const from = old && nodes.find((item) => item.id === old.source);
	const to = old && nodes.find((item) => item.id === old.target);
	const out = continueHandle(node.type ?? "");
	if (!old || !from || !to || !out) return null;

	const a = nodeRect(from);
	const b = nodeRect(to);
	const size = nodeRect(node);
	const placed: BlockNode = {
		...node,
		position: {
			x: (a.x + a.width + b.x) / 2 - size.width / 2,
			y: (a.y + a.height / 2 + b.y + b.height / 2) / 2 - size.height / 2,
		},
	};
	const first = edge(from.id, old.sourceHandle ?? "", node.id, handleId(node.id, "target"));
	const second = edge(node.id, handleId(node.id, out), to.id, old.targetHandle ?? "");

	// Fan-out blocks key their branches by target id: the new block takes B's slot.
	const fanOut = FAN_OUT_HANDLES.includes(kindOf(from.id, old.sourceHandle));
	const withOrder = deselected.map((item) =>
		fanOut && item.id === from.id ? { ...item, data: retarget(item.data, to.id, node.id) } : item,
	);

	return {
		nodes: [...withOrder, placed],
		edges: [...edges.filter((item) => item.id !== old.id), first, second],
		upsertedBlocks: fanOut ? [node.id, from.id] : [node.id],
		upsertedEdges: [first.id, second.id],
		deletedEdges: [old.id],
	};
}

/** What BlockCanvas hands `applyQuickAdd` to write the change with. */
export type QuickAddSink = {
	commit: () => void;
	markUpserted: (kind: "blocks" | "edges", ids: Iterable<string>) => void;
	markDeleted: (kind: "blocks" | "edges", ids: Iterable<string>) => void;
	setGraph: (nodes: BlockNode[], edges: BlockEdge[]) => void;
};

/** One undo point for the whole add + connect (or edge split). */
export function applyQuickAdd(result: QuickAddResult, sink: QuickAddSink) {
	sink.commit();
	sink.markUpserted("blocks", result.upsertedBlocks);
	sink.markUpserted("edges", result.upsertedEdges);
	sink.markDeleted("edges", result.deletedEdges);
	sink.setGraph(result.nodes, result.edges);
}
