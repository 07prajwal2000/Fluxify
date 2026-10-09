import { getOutputHandles, HANDLE_SIDE, type HandleKind, type HandleSide } from "./blockHandles";
import { BlockTypes } from "./blockTypes";
import type { LayoutEdge, LayoutNode } from "./layout";

const HANDLE_KINDS = Object.keys(HANDLE_SIDE) as HandleKind[];

const handleKind = (handleId: string) =>
	HANDLE_KINDS.find((candidate) => handleId.endsWith(`-${candidate}`));

/** Which side of the block a handle id (`<blockId>-<kind>`) sits on. */
export function handleSide(handleId: string): HandleSide {
	const kind = handleKind(handleId);
	return kind ? HANDLE_SIDE[kind] : "right";
}

const SIDE_RANK: Record<HandleSide, number> = { top: -1, left: 0, right: 0, bottom: 1 };
/** Roots sort entrypoint flow first, error handler flow last, anything else between. */
const ROOT_RANK: Record<string, number> = {
	[BlockTypes.entrypoint]: 0,
	[BlockTypes.errorHandler]: 2,
};

const byPosition = (a: LayoutNode, b: LayoutNode) =>
	(a.position?.y ?? 0) - (b.position?.y ?? 0) || a.id.localeCompare(b.id);

/**
 * One band per root (a block nothing feeds into): the entrypoint's flow, then
 * other roots, then the error handler's. A block reachable from several roots
 * belongs to the first one, so bands never interleave. Blocks no root reaches
 * (only a cycle does that) share a last band.
 */
export function splitIntoBands(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutNode[][] {
	const children = new Map<string, string[]>();
	const fed = new Set<string>();
	for (const e of edges) {
		children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
		fed.add(e.to);
	}
	const rank = (n: LayoutNode) => ROOT_RANK[n.type ?? ""] ?? 1;
	const roots = nodes
		.filter((n) => !fed.has(n.id))
		.sort((a, b) => rank(a) - rank(b) || byPosition(a, b));

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
 * Where a branch sits among its siblings: the side of the parent's handle (top
 * above, bottom below), the handle's place among the parent's outputs, then its
 * place in a fan-out branch list (listed first, the default case last).
 */
function branchKey(edge: LayoutEdge, parent: LayoutNode): number[] {
	const handle = edge.fromHandle ?? `${edge.from}-source`;
	const data = (parent.data ?? {}) as { order?: unknown; defaultCase?: unknown };
	const order = Array.isArray(data.order) ? (data.order as string[]) : [];
	const listed = order.indexOf(edge.to);
	const outputs = getOutputHandles(parent.type ?? "");
	return [
		// a lone top handle (executor, orchestrate) is drawn on the right instead
		outputs.length === 1 ? 0 : SIDE_RANK[handleSide(handle)],
		outputs.indexOf(handleKind(handle) ?? "source"),
		edge.to === data.defaultCase ? order.length + 1 : listed === -1 ? order.length : listed,
	];
}

const compareKeys = (a: number[], b: number[]) => {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
	return 0;
};

/**
 * Lays one root's flow out in lanes. Each branch is a lane that runs straight
 * to its own terminal block; sibling lanes stack in handle order (top-side
 * handles above). A block that several branches converge on belongs to no lane:
 * it goes after them, centred between its parents, so no edge crosses a lane.
 * The previous y only breaks ties, so a reflow is stable and blocks with no
 * position still land in a fixed order.
 *
 * Returns each block's top edge relative to the band's top, and the band height.
 */
export function layoutBand(
	band: LayoutNode[],
	edges: LayoutEdge[],
	layers: Map<string, number>,
	heightOf: (n: LayoutNode) => number,
	gap: number,
): { tops: Map<string, number>; height: number } {
	const byId = new Map(band.map((n) => [n.id, n]));
	const out = new Map<string, LayoutEdge[]>();
	const parents = new Map<string, string[]>();
	for (const e of edges) {
		out.set(e.from, [...(out.get(e.from) ?? []), e]);
		const known = parents.get(e.to) ?? [];
		if (!known.includes(e.from)) parents.set(e.to, [...known, e.from]);
	}
	const isJoin = (id: string) => (parents.get(id)?.length ?? 0) > 1;

	const lanes = new Map<string, LayoutNode[]>();
	const lanesOf = (id: string) => {
		const known = lanes.get(id);
		if (known) return known;
		const parent = byId.get(id)!;
		const seen = new Set<string>();
		const branches = (out.get(id) ?? [])
			.filter((e) => e.to !== id && !isJoin(e.to) && !seen.has(e.to) && seen.add(e.to))
			.sort(
				(a, b) =>
					compareKeys(branchKey(a, parent), branchKey(b, parent)) ||
					byPosition(byId.get(a.to)!, byId.get(b.to)!),
			)
			.map((e) => byId.get(e.to)!);
		lanes.set(id, branches);
		return branches;
	};

	// A lane is as tall as the block or the lanes it fans out into, whichever is more.
	const slots = new Map<string, number>();
	const slotOf = (n: LayoutNode, path: Set<string>): number => {
		const known = slots.get(n.id);
		if (known !== undefined) return known;
		if (path.has(n.id)) return heightOf(n);
		path.add(n.id);
		const kids = lanesOf(n.id).map((k) => slotOf(k, path));
		path.delete(n.id);
		const stacked = kids.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, kids.length - 1);
		slots.set(n.id, Math.max(heightOf(n), stacked));
		return slots.get(n.id)!;
	};

	const centre = new Map<string, number>();
	const ordered = [...band].sort(
		(a, b) => (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0) || byPosition(a, b),
	);
	for (const node of ordered) {
		if (!centre.has(node.id)) {
			const above = (parents.get(node.id) ?? []).flatMap((p) => centre.get(p) ?? []);
			centre.set(node.id, above.length ? (Math.min(...above) + Math.max(...above)) / 2 : 0);
		}
		const kids = lanesOf(node.id).filter((k) => !centre.has(k.id));
		const sizes = kids.map((k) => slotOf(k, new Set()));
		const stacked = sizes.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, kids.length - 1);
		let top = centre.get(node.id)! - stacked / 2;
		kids.forEach((kid, i) => {
			centre.set(kid.id, top + sizes[i]! / 2);
			top += sizes[i]! + gap;
		});
	}

	// Lanes never overlap, but a converged block's own flow can land on one: push down.
	const tops = new Map<string, number>();
	const columns = new Map<number, LayoutNode[]>();
	for (const node of band) {
		const layer = layers.get(node.id) ?? 0;
		columns.set(layer, [...(columns.get(layer) ?? []), node]);
	}
	for (const column of columns.values()) {
		column.sort((a, b) => centre.get(a.id)! - centre.get(b.id)! || byPosition(a, b));
		let floor = Number.NEGATIVE_INFINITY;
		for (const node of column) {
			const top = Math.max(centre.get(node.id)! - heightOf(node) / 2, floor);
			tops.set(node.id, top);
			floor = top + heightOf(node) + gap;
		}
	}

	const min = Math.min(...tops.values());
	const bottom = Math.max(...band.map((n) => tops.get(n.id)! + heightOf(n)));
	for (const [id, top] of tops) tops.set(id, top - min);
	return { tops, height: bottom - min };
}
