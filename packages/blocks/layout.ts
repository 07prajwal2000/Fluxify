import { BlockTypes } from "./blockTypes";
import { HANDLE_SIDE, type HandleKind, type HandleSide } from "./blockHandles";

export { HANDLE_SIDE, type HandleKind, type HandleSide } from "./blockHandles";

/**
 * Canvas auto-layout, shared by the editor's Format button and the AI harness.
 *
 * The harness needs it because a model places blocks by writing coordinates for
 * a canvas it cannot see: inserting one block into an existing route left the
 * next block sitting on top of the response block. Anything that mutates a
 * canvas runs this over the result rather than trusting those coordinates.
 *
 * Hand-rolled rather than ELK: elkjs only lays out inside a worker, and its
 * in-process fallback worker is a CommonJS export Bun cannot see, so the server
 * could not construct one at all. A block canvas is a left-to-right DAG with at
 * most one edge per output socket — longest-path layering covers it in a
 * fraction of the code, with no dependency and no async.
 */

/** Fallbacks for blocks nothing has measured yet — the server never measures. */
const FALLBACK_WIDTH = 168;
const FALLBACK_HEIGHT = 48;

export type LayoutNode = {
	id: string;
	/** Block type; sticky notes are left where the user put them. */
	type?: string;
	position?: { x: number; y: number } | null;
	width?: number | null;
	height?: number | null;
};

export type LayoutEdge = {
	id?: string;
	from: string;
	to: string;
	fromHandle?: string | null;
	toHandle?: string | null;
};

export type LayoutOptions = {
	/** Gap between blocks in the same column. */
	nodeSpacing?: number;
	/** Gap between columns. */
	layerSpacing?: number;
	/**
	 * Ids the caller just added or moved. When given, the blocks that did NOT
	 * change stay the frame of reference — the graph is re-flowed around them
	 * instead of jumping to the origin — and only blocks that end up somewhere
	 * new are returned.
	 */
	changedIds?: Iterable<string>;
};

export type LayoutPositions = Record<string, { x: number; y: number }>;

const HANDLE_KINDS = Object.keys(HANDLE_SIDE) as HandleKind[];

/** Which side of the block a handle id (`<blockId>-<kind>`) sits on. */
export function handleSide(handleId: string): HandleSide {
	const kind = HANDLE_KINDS.find((candidate) => handleId.endsWith(`-${candidate}`));
	return kind ? HANDLE_SIDE[kind] : "right";
}

/**
 * Column per block: one past its furthest predecessor. Cycles cannot come out
 * of the editor, but a model can emit one, so the walk is depth-capped instead
 * of trusting the input to terminate.
 */
export function layerOf(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
): Map<string, number> {
	const incoming = new Map<string, string[]>();
	for (const node of nodes) incoming.set(node.id, []);
	for (const edge of edges) incoming.get(edge.to)?.push(edge.from);

	const layers = new Map<string, number>();
	const walk = (id: string, seen: Set<string>): number => {
		const known = layers.get(id);
		if (known !== undefined) return known;
		if (seen.has(id)) return 0;
		seen.add(id);
		const parents = incoming.get(id) ?? [];
		const layer = parents.length
			? Math.max(...parents.map((p) => walk(p, seen) + 1))
			: 0;
		seen.delete(id);
		layers.set(id, layer);
		return layer;
	};
	for (const node of nodes) walk(node.id, new Set());
	return layers;
}

/**
 * Shifts the result so the blocks the caller did not touch stay closest to
 * where they already were. Laying out from the origin would drag the whole
 * graph across the screen when one block is added — a correct layout that
 * reads as the editor throwing away the user's arrangement.
 */
function anchorOffset(
	nodes: LayoutNode[],
	positions: LayoutPositions,
	changed: Set<string>,
): { x: number; y: number } {
	const unchanged = nodes.filter(
		(n) => !changed.has(n.id) && n.position && positions[n.id],
	);
	if (unchanged.length === 0) return { x: 0, y: 0 };
	// The leftmost survivor: anchoring on the head of the flow keeps the reading
	// order stable, where an average would smear the offset across a reflow.
	const anchor = unchanged.reduce((best, n) =>
		positions[n.id]!.x < positions[best.id]!.x ? n : best,
	);
	return {
		x: anchor.position!.x - positions[anchor.id]!.x,
		y: anchor.position!.y - positions[anchor.id]!.y,
	};
}

/**
 * Lays the graph out left to right, one column per step, columns centred on a
 * common axis. Sticky notes are excluded, so callers keep their positions.
 * With `changedIds`, only the blocks that actually moved come back.
 */
export function layoutGraph(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	{ nodeSpacing = 24, layerSpacing = 64, changedIds }: LayoutOptions = {},
): LayoutPositions {
	const laidOut = nodes.filter((node) => node.type !== BlockTypes.sticky_note);
	if (laidOut.length === 0) return {};

	const placed = new Set(laidOut.map((n) => n.id));
	const graphEdges = edges.filter((e) => placed.has(e.from) && placed.has(e.to));
	const layers = layerOf(laidOut, graphEdges);

	const columns = new Map<number, LayoutNode[]>();
	for (const node of laidOut) {
		const layer = layers.get(node.id) ?? 0;
		columns.set(layer, [...(columns.get(layer) ?? []), node]);
	}

	const widthOf = (n: LayoutNode) => n.width ?? FALLBACK_WIDTH;
	const heightOf = (n: LayoutNode) => n.height ?? FALLBACK_HEIGHT;

	// Within a column, keep the order the blocks already had on screen so a
	// reflow does not shuffle siblings the user is reading top to bottom.
	const positions: LayoutPositions = {};
	let x = 0;
	for (const layer of [...columns.keys()].sort((a, b) => a - b)) {
		const column = [...columns.get(layer)!].sort(
			(a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0),
		);
		const total =
			column.reduce((sum, n) => sum + heightOf(n), 0) +
			nodeSpacing * (column.length - 1);
		let y = -total / 2;
		for (const node of column) {
			positions[node.id] = { x, y };
			y += heightOf(node) + nodeSpacing;
		}
		x += Math.max(...column.map(widthOf)) + layerSpacing;
	}

	if (!changedIds) return positions;

	const changed = new Set(changedIds);
	const offset = anchorOffset(laidOut, positions, changed);
	const moved: LayoutPositions = {};
	for (const node of laidOut) {
		const next = positions[node.id];
		if (!next) continue;
		const x = next.x + offset.x;
		const y = next.y + offset.y;
		// A block that lands where it already was is not a change to persist.
		if (node.position && node.position.x === x && node.position.y === y) continue;
		moved[node.id] = { x, y };
	}
	return moved;
}
