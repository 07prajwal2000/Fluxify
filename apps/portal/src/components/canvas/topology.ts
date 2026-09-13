import type { EdgeChange, NodeChange } from "@xyflow/react";
import type { CanvasChanges } from "./changes";
import type { BlockEdge, BlockNode } from "./types";

/**
 * Changes that only affect presentation — not worth reporting as an edit.
 * `dimensions` covers both measuring a node (cosmetic) and a resize gesture; the
 * gesture's closing change carries `resizing: false`, so a resize is recorded
 * once, on release, instead of on every frame.
 */
export function isCosmetic(change: NodeChange<BlockNode> | EdgeChange<BlockEdge>) {
	if (change.type === "select") return true;
	return change.type === "dimensions" && change.resizing !== false;
}

/**
 * Identity of a graph's shape: which blocks and edges it holds. Two loads with
 * the same signature are the same graph (a refetch after saving), so recorded
 * undo snapshots still apply to it.
 */
export function graphTopology(nodes: BlockNode[], edges: BlockEdge[]): string {
	const ids = (values: { id: string }[]) =>
		values
			.map((value) => value.id)
			.sort()
			.join(",");
	return `${ids(nodes)}|${ids(edges)}`;
}

/** Feeds a batch of React Flow changes into the change tracker. */
export function track(
	tracker: CanvasChanges,
	kind: "blocks" | "edges",
	changes: (NodeChange<BlockNode> | EdgeChange<BlockEdge>)[],
) {
	const upserted: string[] = [];
	const deleted: string[] = [];
	for (const change of changes) {
		if (isCosmetic(change)) continue;
		if (change.type === "remove") deleted.push(change.id);
		else if (change.type === "add" || change.type === "replace")
			upserted.push(change.item.id);
		else upserted.push(change.id);
	}
	if (upserted.length) tracker.markUpserted(kind, upserted);
	if (deleted.length) tracker.markDeleted(kind, deleted);
}
