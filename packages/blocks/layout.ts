import { getOutputHandles, type HandleSpecs } from "./blockHandles";
import { BlockTypes } from "./blockTypes";
import { handleSide, isBodyEdge, layoutBand, splitIntoBands } from "./layoutLanes";

export {
	BODY_HANDLES,
	type BodyCorner,
	FAN_OUT_HANDLES,
	getOutputHandles,
	HANDLE_SIDE,
	type HandleKind,
	type HandlePosition,
	type HandleSide,
	type HandleSpec,
	type HandleSpecs,
	handleCorner,
	isBodyHandle,
	isFanOutHandle,
	positionOf,
	sideOf,
	sortByOrder,
} from "./blockHandles";

/**
 * Canvas auto-layout, shared by the editor's Format button and the AI agent.
 *
 * The agent needs it because a model places blocks by writing coordinates for
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

/** Card sizes as the editor draws them: the server never measures, so it uses these. */
const FALLBACK_WIDTH = 168;
const COMPACT_WIDTH = 64;
const FALLBACK_HEIGHT = 64;

export type BlockVariant = "default" | "compact" | "container";

/**
 * Card design by sockets: a body handle makes a container; at most one input and
 * one output, or a true/false pair, makes a compact square.
 */
export function blockVariant(handles: readonly string[]): BlockVariant {
	if (handles.some((kind) => kind === "executor" || kind === "orchestrate")) return "container";
	if (handles.includes("success") || handles.includes("failure")) {
		const branch = handles.every(
			(kind) => kind === "target" || kind === "success" || kind === "failure",
		);
		return branch ? "compact" : "default";
	}
	const simple = handles.every((kind) => kind === "target" || kind === "source");
	return simple && handles.length > 0 ? "compact" : "default";
}

const BUILTIN = new Set<string>(Object.values(BlockTypes));
const NO_INPUT = new Set<string>([BlockTypes.entrypoint, BlockTypes.errorHandler]);

/** A builtin block's sockets, inputs first; undefined for a custom or plugin type. */
export function builtinHandles(type: string): string[] | undefined {
	if (!BUILTIN.has(type)) return undefined;
	return [...(NO_INPUT.has(type) ? [] : ["target"]), ...getOutputHandles(type)];
}

/** How wide the editor draws a block: compact builtins are squares, every other card is wide. */
export function blockWidth(type: string): number {
	const handles = builtinHandles(type);
	return handles && blockVariant(handles) === "compact" ? COMPACT_WIDTH : FALLBACK_WIDTH;
}

/**
 * Where the blocks a new canvas starts with are placed. The response sits to
 * the right with room to drop blocks in between; the error handler sits
 * below. Workflows and custom blocks have no response.
 */
export const STARTER_POSITIONS = {
	entrypoint: { x: 0, y: 0 },
	response: { x: FALLBACK_WIDTH + 232, y: 0 },
	errorHandler: { x: 0, y: 160 },
} as const;

export type LayoutNode = {
	id: string;
	/** Block type; sticky notes are left where the user put them. */
	type?: string;
	position?: { x: number; y: number } | null;
	width?: number | null;
	height?: number | null;
	/** Block data; only `order` / `defaultCase` (fan-out branch order) are read. */
	data?: unknown;
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
	/** Handle specs of non-builtin types in the graph; a type left out lays out as builtin. */
	handleSpecs?: HandleSpecs;
};

export type LayoutPositions = Record<string, { x: number; y: number }>;

export { handleSide };

/**
 * Column per block: one past its furthest predecessor. Cycles cannot come out
 * of the editor, but a model can emit one, so the walk is depth-capped instead
 * of trusting the input to terminate.
 */
export function layerOf(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	specs: HandleSpecs = {},
): Map<string, number> {
	const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
	// A body handle (top/bottom) stacks its block under or over the parent in the
	// same column, so the edge adds no step; any other edge moves one column right.
	const incoming = new Map<string, { from: string; step: number }[]>();
	for (const node of nodes) incoming.set(node.id, []);
	for (const edge of edges) {
		const step = isBodyEdge(edge, (id) => typeOf.get(id), specs) ? 0 : 1;
		incoming.get(edge.to)?.push({ from: edge.from, step });
	}

	const layers = new Map<string, number>();
	const walk = (id: string, seen: Set<string>): number => {
		const known = layers.get(id);
		if (known !== undefined) return known;
		if (seen.has(id)) return 0;
		seen.add(id);
		const parents = incoming.get(id) ?? [];
		const layer = parents.length ? Math.max(...parents.map((p) => walk(p.from, seen) + p.step)) : 0;
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
	const unchanged = nodes.filter((n) => !changed.has(n.id) && n.position && positions[n.id]);
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

/** How far a block under/over a body handle is shifted right of its parent. */
const BODY_INDENT = 56;

/**
 * Horizontal shift of blocks stacked on a body handle: each level of nesting
 * sits `BODY_INDENT` right of the block it hangs from, inside the parent's column.
 */
function indentOf(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	layers: Map<string, number>,
	specs: HandleSpecs,
): Map<string, number> {
	const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
	const bodyParents = new Map<string, string[]>();
	for (const e of edges) {
		if (layers.get(e.from) !== layers.get(e.to)) continue;
		if (!isBodyEdge(e, (id) => typeOf.get(id), specs)) continue;
		bodyParents.set(e.to, [...(bodyParents.get(e.to) ?? []), e.from]);
	}
	const indents = new Map<string, number>();
	const walk = (id: string, seen: Set<string>): number => {
		const known = indents.get(id);
		if (known !== undefined) return known;
		if (seen.has(id)) return 0;
		seen.add(id);
		const parents = bodyParents.get(id) ?? [];
		const indent = parents.length
			? Math.max(...parents.map((p) => walk(p, seen) + BODY_INDENT))
			: 0;
		seen.delete(id);
		indents.set(id, indent);
		return indent;
	};
	for (const n of nodes) walk(n.id, new Set());
	return indents;
}

/** Space between two root bands. */
const BAND_SPACING = 48;

/**
 * Lays the graph out left to right, one column per step, one lane per branch. Sticky notes are excluded, so callers keep their positions.
 * With `changedIds`, only the blocks that actually moved come back.
 */
export function layoutGraph(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	{ nodeSpacing = 24, layerSpacing = 64, changedIds, handleSpecs }: LayoutOptions = {},
): LayoutPositions {
	const laidOut = nodes.filter((node) => node.type !== BlockTypes.sticky_note);
	if (laidOut.length === 0) return {};

	const byId = new Map(laidOut.map((n) => [n.id, n]));
	// The compiler ignores an edge into the error handler, so layout does too:
	// that keeps the handler a root with a band of its own.
	const graphEdges = edges.filter(
		(e) => byId.has(e.from) && byId.has(e.to) && byId.get(e.to)!.type !== BlockTypes.errorHandler,
	);
	const layers = layerOf(laidOut, graphEdges, handleSpecs);
	const indents = indentOf(laidOut, graphEdges, layers, handleSpecs ?? {});
	const heightOf = (n: LayoutNode) => n.height ?? FALLBACK_HEIGHT;

	// Columns are shared by every band so a block lines up with its peers.
	const columnX = new Map<number, number>();
	let x = 0;
	for (const layer of [...new Set(layers.values())].sort((a, b) => a - b)) {
		columnX.set(layer, x);
		const members = laidOut.filter((n) => layers.get(n.id) === layer);
		x +=
			Math.max(...members.map((n) => (indents.get(n.id) ?? 0) + (n.width ?? blockWidth(n.type ?? "")))) +
			layerSpacing;
	}

	const positions: LayoutPositions = {};
	let bandTop = 0;
	for (const band of splitIntoBands(laidOut, graphEdges)) {
		const inBand = new Set(band.map((n) => n.id));
		const bandEdges = graphEdges.filter((e) => inBand.has(e.from) && inBand.has(e.to));
		const { tops, height } = layoutBand(
			band,
			bandEdges,
			layers,
			heightOf,
			nodeSpacing,
			handleSpecs,
			indents,
		);
		for (const node of band) {
			positions[node.id] = {
				x: columnX.get(layers.get(node.id) ?? 0)! + (indents.get(node.id) ?? 0),
				y: bandTop + tops.get(node.id)!,
			};
		}
		bandTop += height + BAND_SPACING;
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
