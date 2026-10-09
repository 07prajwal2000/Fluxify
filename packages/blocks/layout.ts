import { getOutputHandles, HANDLE_SIDE, type HandleKind, type HandleSide } from "./blockHandles";
import { BlockTypes } from "./blockTypes";

export {
	FAN_OUT_HANDLES,
	HANDLE_SIDE,
	type HandleKind,
	type HandleSide,
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

/** Fallbacks for blocks nothing has measured yet — the server never measures. */
const FALLBACK_WIDTH = 168;
const FALLBACK_HEIGHT = 48;

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
};

export type LayoutPositions = Record<string, { x: number; y: number }>;

const HANDLE_KINDS = Object.keys(HANDLE_SIDE) as HandleKind[];

const handleKind = (handleId: string) =>
	HANDLE_KINDS.find((candidate) => handleId.endsWith(`-${candidate}`));

/** Which side of the block a handle id (`<blockId>-<kind>`) sits on. */
export function handleSide(handleId: string): HandleSide {
	const kind = handleKind(handleId);
	return kind ? HANDLE_SIDE[kind] : "right";
}

/**
 * Column per block: one past its furthest predecessor. Cycles cannot come out
 * of the editor, but a model can emit one, so the walk is depth-capped instead
 * of trusting the input to terminate.
 */
export function layerOf(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, number> {
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
		const layer = parents.length ? Math.max(...parents.map((p) => walk(p, seen) + 1)) : 0;
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

const SIDE_RANK: Record<HandleSide, number> = { top: -1, left: 0, right: 0, bottom: 1 };
/** Roots sort entrypoint flow first, error handler flow last, anything else between. */
const ROOT_RANK: Record<string, number> = {
	[BlockTypes.entrypoint]: 0,
	[BlockTypes.errorHandler]: 2,
};
/** Space between two root bands. */
const BAND_SPACING = 48;

/**
 * One band per root (a block nothing feeds into): the entrypoint's flow, then
 * other roots, then the error handler's. A block reachable from several roots
 * belongs to the first one, so bands never interleave. Blocks no root reaches
 * (only a cycle does that) share a last band.
 */
function splitIntoBands(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutNode[][] {
	const children = new Map<string, string[]>();
	const fed = new Set<string>();
	for (const e of edges) {
		children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
		fed.add(e.to);
	}
	const rank = (n: LayoutNode) => ROOT_RANK[n.type ?? ""] ?? 1;
	const roots = nodes
		.filter((n) => !fed.has(n.id))
		.sort(
			(a, b) =>
				rank(a) - rank(b) ||
				(a.position?.y ?? 0) - (b.position?.y ?? 0) ||
				a.id.localeCompare(b.id),
		);

	const byId = new Map(nodes.map((n) => [n.id, n]));
	const owned = new Set<string>();
	const bands: LayoutNode[][] = [];
	for (const root of roots) {
		const band: LayoutNode[] = [];
		const stack = [root.id];
		while (stack.length) {
			const id = stack.pop()!;
			if (owned.has(id)) continue;
			owned.add(id);
			band.push(byId.get(id)!);
			stack.push(...(children.get(id) ?? []));
		}
		bands.push(band);
	}
	const rest = nodes.filter((n) => !owned.has(n.id));
	if (rest.length) bands.push(rest);
	return bands;
}

/**
 * Sort key for a block: the row of the parent it hangs off, the side of that
 * parent's handle (top above, bottom below), the handle's place among the
 * parent's outputs, then its place in a fan-out branch list.
 */
function placementKey(
	node: LayoutNode,
	edges: LayoutEdge[],
	byId: Map<string, LayoutNode>,
	layers: Map<string, number>,
	parentCentre: (id: string) => number,
): number[] {
	const layer = layers.get(node.id) ?? 0;
	const incoming = edges.filter((e) => e.to === node.id);
	const edge =
		incoming.find((e) => (layers.get(e.from) ?? 0) === layer - 1) ??
		incoming.sort((a, b) => parentCentre(a.from) - parentCentre(b.from))[0];
	if (!edge) return [0, 0, 0, 0];
	const parent = byId.get(edge.from)!;
	const handle = edge.fromHandle ?? `${edge.from}-source`;
	const data = (parent.data ?? {}) as { order?: unknown; defaultCase?: unknown };
	const order = Array.isArray(data.order) ? (data.order as string[]) : [];
	const listed = order.indexOf(node.id);
	return [
		parentCentre(edge.from),
		// a lone top handle (executor, orchestrate) is drawn on the right instead
		getOutputHandles(parent.type ?? "").length === 1 ? 0 : SIDE_RANK[handleSide(handle)],
		getOutputHandles(parent.type ?? "").indexOf(handleKind(handle) ?? "source"),
		// listed cases first, unlisted after them, the default case last
		node.id === data.defaultCase ? order.length + 1 : listed === -1 ? order.length : listed,
	];
}

/**
 * Orders one column top to bottom by where each block hangs off its parent. The
 * previous y only breaks ties, so a reflow keeps the order the user sees and
 * agent-added blocks with no position still land in a stable order.
 */
function orderColumn(
	column: LayoutNode[],
	edges: LayoutEdge[],
	byId: Map<string, LayoutNode>,
	layers: Map<string, number>,
	parentCentre: (id: string) => number,
): LayoutNode[] {
	const keys = new Map(
		column.map((n) => [n.id, placementKey(n, edges, byId, layers, parentCentre)]),
	);
	return [...column].sort((a, b) => {
		const ka = keys.get(a.id)!;
		const kb = keys.get(b.id)!;
		for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
		return (a.position?.y ?? 0) - (b.position?.y ?? 0) || a.id.localeCompare(b.id);
	});
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

	const byId = new Map(laidOut.map((n) => [n.id, n]));
	// The compiler ignores an edge into the error handler, so layout does too:
	// that keeps the handler a root with a band of its own.
	const graphEdges = edges.filter(
		(e) => byId.has(e.from) && byId.has(e.to) && byId.get(e.to)!.type !== BlockTypes.errorHandler,
	);
	const layers = layerOf(laidOut, graphEdges);
	const heightOf = (n: LayoutNode) => n.height ?? FALLBACK_HEIGHT;

	// Columns are shared by every band so a block lines up with its peers.
	const columnX = new Map<number, number>();
	let x = 0;
	for (const layer of [...new Set(layers.values())].sort((a, b) => a - b)) {
		columnX.set(layer, x);
		const members = laidOut.filter((n) => layers.get(n.id) === layer);
		x += Math.max(...members.map((n) => n.width ?? FALLBACK_WIDTH)) + layerSpacing;
	}

	const positions: LayoutPositions = {};
	let bandTop = 0;
	for (const band of splitIntoBands(laidOut, graphEdges)) {
		// y relative to the band's own centre line, until the band is stacked.
		const local = new Map<string, number>();
		const inBand = new Set(band.map((n) => n.id));
		const bandEdges = graphEdges.filter((e) => inBand.has(e.from) && inBand.has(e.to));
		const centreOf = (id: string) => (local.get(id) ?? 0) + heightOf(byId.get(id)!) / 2;
		const columns = new Map<number, LayoutNode[]>();
		for (const node of band) {
			const layer = layers.get(node.id) ?? 0;
			columns.set(layer, [...(columns.get(layer) ?? []), node]);
		}

		let bandHeight = 0;
		for (const layer of [...columns.keys()].sort((a, b) => a - b)) {
			const column = orderColumn(columns.get(layer)!, bandEdges, byId, layers, centreOf);
			const total =
				column.reduce((sum, n) => sum + heightOf(n), 0) + nodeSpacing * (column.length - 1);
			let y = -total / 2;
			for (const node of column) {
				local.set(node.id, y);
				y += heightOf(node) + nodeSpacing;
			}
			bandHeight = Math.max(bandHeight, total);
		}

		for (const node of band) {
			positions[node.id] = {
				x: columnX.get(layers.get(node.id) ?? 0)!,
				y: bandTop + bandHeight / 2 + local.get(node.id)!,
			};
		}
		bandTop += bandHeight + BAND_SPACING;
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
