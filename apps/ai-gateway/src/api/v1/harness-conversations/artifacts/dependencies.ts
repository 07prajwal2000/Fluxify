/**
 * The dependency graph between one artifact's outputs.
 *
 * A run already produces a DAG — the task graph — and every sub-artifact row is
 * stamped with the task that produced it. This module is the only place that
 * turns those two facts back into edges, so ordering, inline pairing, the apply
 * gate and the cascade skip are all one mechanism instead of four hardcoded
 * ones, each pinned to a single relationship.
 *
 * Nothing here branches on `kind`. A new resource kind that stores its planned
 * id in the payload and is referenced by `targetId` gets ordering and gating
 * for free; if you find yourself adding a kind here, the abstraction is wrong.
 */

/** The columns the graph reads. Deliberately narrow so both the batch apply and
 *  the single apply can pass their own row shapes. */
export interface GraphRow {
	id: string;
	kind: string;
	/** The task that produced this row — the other end of `dependsOn`. */
	subAgentId?: string | null;
	/** Task ids the producing task declared a dependency on. */
	dependsOn?: string[] | null;
	payload?: Record<string, any> | null;
}

/**
 * The resource this row brings into existence, or undefined if it only edits
 * something already live. Only a create is a dependency: a modify targets a
 * resource that is already there, so nothing has to wait for it.
 */
export function createdIdOf(row: Pick<GraphRow, "payload">): string | undefined {
	if (row.payload?.action !== "create") return undefined;
	return (row.payload?.routeId ?? row.payload?.customBlockId) as string | undefined;
}

/** The resource this row hangs itself off. */
export function referencedIdOf(row: Pick<GraphRow, "payload">): string | undefined {
	return row.payload?.targetId as string | undefined;
}

/**
 * The rows this row must be applied after.
 *
 * Two sources, unioned, because neither alone is complete:
 *
 * - **The declared task edge.** Carries dependencies no payload records — a
 *   route that invokes a custom block created in the same run references it by
 *   name, deep inside a canvas, not by an id any column holds.
 * - **The payload link.** `targetId` naming an id another row is creating is
 *   ground truth: it is the same link the apply itself uses to attach the
 *   canvas. The declared edge is a model's claim and can be missing.
 *
 * Rows written before `dependsOn` existed have only the second source, which is
 * exactly the behaviour they had before this module.
 */
export function parentsOf<T extends GraphRow>(row: T, rows: readonly T[]): T[] {
	const declared = new Set(row.dependsOn ?? []);
	const references = referencedIdOf(row);
	return rows.filter(
		(other) =>
			other.id !== row.id &&
			((other.subAgentId != null && declared.has(other.subAgentId)) ||
				(references != null && createdIdOf(other) === references)),
	);
}

/**
 * Every row, ordered so each one follows everything it depends on.
 *
 * Rows with no relationship keep their input order, so a batch whose graph is
 * empty applies exactly as it did before.
 */
export function topoOrder<T extends GraphRow>(rows: readonly T[]): T[] {
	// ponytail: O(n²). A run produces a handful of outputs, not a build graph;
	// swap in Kahn's with an adjacency map if that ever stops being true.
	const parentIds = new Map(
		rows.map((row) => [row.id, parentsOf(row, rows).map((p) => p.id)]),
	);
	const emitted = new Set<string>();
	const out: T[] = [];
	const remaining = [...rows];

	while (remaining.length > 0) {
		const ready = remaining.findIndex((row) =>
			(parentIds.get(row.id) ?? []).every((id) => emitted.has(id)),
		);
		// Only a malformed graph has no ready row. Emitting the rest in input
		// order beats hanging — and the apply gate still refuses anything whose
		// parent genuinely did not land.
		const [row] = remaining.splice(ready === -1 ? 0 : ready, 1);
		if (!row) break;
		emitted.add(row.id);
		out.push(row);
	}
	return out;
}

/**
 * The canvas built for a parent this run is creating. It rides inside the
 * parent's create so the parent never exists without its blocks, which is why
 * it is pulled out of the ordering rather than applied in its own turn.
 *
 * `taken` stops one canvas being inlined into two parents.
 */
export function inlineCanvasFor<T extends GraphRow>(
	parent: T,
	rows: readonly T[],
	taken: ReadonlySet<string>,
): T | undefined {
	if (parent.payload?.action !== "create") return undefined;
	return rows.find(
		(row) =>
			row.kind === "canvas" &&
			!taken.has(row.id) &&
			parentsOf(row, rows).some((p) => p.id === parent.id),
	);
}

/** `custom_block` → `custom block`: the kind, as a human would say it. */
export const kindLabel = (kind: string) => kind.replace(/_/g, " ");
