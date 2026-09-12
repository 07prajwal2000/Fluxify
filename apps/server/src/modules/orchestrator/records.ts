import type { NodeReason, NodeState } from "@fluxify/common/orchestrator";
import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { orchestrationEventsEntity, workerNodesEntity } from "../../db/schema";
import { nodeIdFor } from "./containerSpec";
import type { ObservedNode } from "./plan";
import type { DesiredNode } from "./projection";

/**
 * The node rows and the history, which admin reads and never writes.
 *
 * A row's id **is** the node id the worker writes into its KV heartbeat, so the
 * two stores join without a lookup table: durable facts here, liveness there
 * (§2). That is also why nothing liveness-shaped is stored in this table — a
 * heartbeat per node every few seconds would be pure write amplification, and
 * the TTL in KV is what makes expiry mean something.
 */

export interface NodeEvent {
	nodeId: string;
	claimId: string;
	projectId: string | null;
	/** `created`, `removed`, `recreated`, `create_failed`, … */
	action: string;
	reason?: NodeReason | null;
	detail?: Record<string, unknown>;
}

export async function recordEvent(event: NodeEvent): Promise<void> {
	await db.insert(orchestrationEventsEntity).values({
		nodeId: event.nodeId,
		claimId: event.claimId,
		projectId: event.projectId,
		action: event.action,
		reason: event.reason ?? null,
		detail: event.detail ?? null,
	});
}

/**
 * The state this node is in, as the platform reports it. `ready` here means the
 * container is running; whether it is actually serving is the `ready` flag in
 * its heartbeat, which the status surfaces join in (§14.5). Two sources for two
 * different questions rather than one guess about both.
 */
function nodeState(node: DesiredNode, container: ObservedNode | undefined): NodeState {
	if (!node.placeable) return container ? "ready" : "pending";
	if (!container) return "failed";
	return container.running ? "ready" : "starting";
}

/** Mirrors desired state into the node table, so admin can read what exists. */
export async function syncNodeRows(
	desired: readonly DesiredNode[],
	observed: readonly ObservedNode[],
): Promise<void> {
	const byNode = new Map(observed.map((container) => [container.nodeId, container]));
	const keep = new Set<string>();

	for (const node of desired) {
		const id = nodeIdFor(node.claimId, node.replicaIndex);
		const container = byNode.get(id);
		keep.add(id);
		const row = {
			id,
			claimId: node.claimId,
			replicaIndex: node.replicaIndex,
			projectId: node.projectId,
			type: node.type,
			groupIds: node.groupIds,
			excludedGroups: node.excludedGroups,
			state: nodeState(node, container),
			reason: node.reason,
			image: container?.image ?? null,
			containerId: container?.containerId ?? null,
		};
		await db
			.insert(workerNodesEntity)
			.values(row)
			.onConflictDoUpdate({
				target: [workerNodesEntity.claimId, workerNodesEntity.replicaIndex],
				set: row,
			});
	}

	// Rows for replicas nobody asks for any more. A deleted claim cascades its
	// rows away on its own; this covers a claim that was scaled down.
	const existing = await db.select({ id: workerNodesEntity.id }).from(workerNodesEntity);
	const stale = existing.map((row) => row.id).filter((id) => !keep.has(id));
	if (stale.length) {
		await db.delete(workerNodesEntity).where(inArray(workerNodesEntity.id, stale));
	}
}
