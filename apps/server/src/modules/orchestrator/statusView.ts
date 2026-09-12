import {
	groupPair,
	type NodeReason,
	type NodeState,
	type NodeType,
} from "@fluxify/common/orchestrator";
import { nodeIdFor } from "./containerSpec";
import type { DesiredNode } from "./projection";

/**
 * What the two status surfaces display (§14.5), assembled from three sources
 * that each answer a different question.
 *
 * - The **projection** says what should exist and why something cannot — the
 *   license and pool refusals belong to intent, not to a container.
 * - The **node row** says what the orchestrator observed on its last pass.
 * - The **heartbeat** says whether the process is actually serving right now.
 *
 * Only the last of those expires on its own, which is the whole reason it is
 * not in Postgres: a row saying `ready` and no heartbeat is exactly the
 * condition worth showing a person, and a store where liveness never expires
 * cannot express it.
 *
 * Pure: no database, no broker, no clock. Every caller has already read its
 * own rows.
 */

/** A `worker_nodes` row, as the orchestrator last wrote it. */
export interface NodeRow {
	id: string;
	claimId: string;
	replicaIndex: number;
	projectId: string | null;
	state: NodeState;
	reason: NodeReason | null;
	image: string | null;
	containerId: string | null;
	updatedAt: Date;
}

/** A live heartbeat, keyed by node id. Absent means no renewal within the TTL. */
export interface Heartbeat {
	ready: boolean;
	at: string;
}

/** A `node_claims` row. One claim is one workload: a type, its groups, its replicas. */
export interface ClaimRow {
	id: string;
	projectId: string | null;
	type: NodeType;
	groupIds: string[];
	replicas: number;
	createdAt: Date;
	createdBy?: string | null;
}

export interface NodeView {
	id: string;
	claimId: string;
	replicaIndex: number;
	projectId: string | null;
	type: NodeType;
	groupIds: string[];
	excludedGroups: string[];
	state: NodeState;
	reason: NodeReason | null;
	image: string | null;
	containerId: string | null;
	/** A heartbeat arrived within its TTL. */
	live: boolean;
	/** The worker says it is serving, not merely running. */
	serving: boolean;
	lastHeartbeatAt: string | null;
	observedAt: string | null;
}

export interface ClaimView extends Omit<ClaimRow, "createdAt"> {
	createdAt: string;
	nodes: NodeView[];
}

/**
 * The state to show, from all three sources.
 *
 * Precedence is deliberate: intent first (a node the license or the pool
 * refuses is `pending` whatever a stale row says), then the heartbeat, then the
 * row. The heartbeat outranks the row because it is seconds old and the row is
 * a pass old — a node that has just become ready should not read `starting` for
 * another five seconds.
 */
function display(
	node: DesiredNode,
	row: NodeRow | undefined,
	beat: Heartbeat | undefined,
): { state: NodeState; reason: NodeReason | null } {
	if (!node.placeable) return { state: "pending", reason: node.reason };
	if (beat) return { state: beat.ready ? "ready" : "starting", reason: null };
	// No heartbeat. A row that claims the container is up is then the
	// interesting case: the container exists and the process inside it is not
	// answering, which is `unhealthy` rather than `ready`.
	if (row?.state === "ready" || row?.state === "unhealthy")
		return { state: "unhealthy", reason: "heartbeat_stale" };
	// No row at all means no pass has happened yet — on a stack with no
	// orchestrator running, that is every node, and it is honest to leave them
	// pending rather than invent a failure.
	if (!row) return { state: "pending", reason: null };
	return { state: row.state, reason: row.reason };
}

export interface ViewInput {
	claims: readonly ClaimRow[];
	desired: readonly DesiredNode[];
	rows: readonly NodeRow[];
	heartbeats: ReadonlyMap<string, Heartbeat>;
}

/** Claims with their replicas resolved into nodes, in the order they were made. */
export function buildClaimViews({ claims, desired, rows, heartbeats }: ViewInput): ClaimView[] {
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const byClaim = new Map<string, NodeView[]>();

	for (const node of desired) {
		const id = nodeIdFor(node.claimId, node.replicaIndex);
		const row = rowById.get(id);
		const beat = heartbeats.get(id);
		const { state, reason } = display(node, row, beat);
		const views = byClaim.get(node.claimId) ?? [];
		views.push({
			id,
			claimId: node.claimId,
			replicaIndex: node.replicaIndex,
			projectId: node.projectId,
			type: node.type,
			groupIds: node.groupIds,
			excludedGroups: node.excludedGroups,
			state,
			reason,
			image: row?.image ?? null,
			containerId: row?.containerId ?? null,
			live: beat !== undefined,
			serving: beat?.ready ?? false,
			lastHeartbeatAt: beat?.at ?? null,
			observedAt: row?.updatedAt.toISOString() ?? null,
		});
		byClaim.set(node.claimId, views);
	}

	return claims.map((claim) => ({
		...claim,
		createdAt: claim.createdAt.toISOString(),
		nodes: (byClaim.get(claim.id) ?? []).sort((a, b) => a.replicaIndex - b.replicaIndex),
	}));
}

/**
 * Nodes against the ceiling. Counted from what the projection placed rather
 * than from containers, so the number matches the reason a pending node shows:
 * "4 of 2 used" and "pool_unavailable" are then the same fact stated twice.
 */
export function poolUsage(desired: readonly DesiredNode[], maxNodes: number) {
	const placed = desired.filter((node) => node.placeable).length;
	return { placed, requested: desired.length, ceiling: maxNodes };
}

/** A trigger group that has work to do, from the triggers table. */
export interface ActiveGroup {
	projectId: string;
	groupId: string;
	groupName: string;
	activeTriggers: number;
}

export interface GroupAlarm extends ActiveGroup {
	/** Nodes that would serve it if any were healthy — 0 reads as "nothing claims this". */
	claimedNodes: number;
}

/**
 * Whether one node serves one group.
 *
 * A node with no groups serves every group its project covers, which is what a
 * catch-all deployment is; a catch-all node additionally skips the pairs a
 * dedicated claim already owns, so a newly created group falls to it with
 * nothing to update.
 */
function covers(node: NodeView, projectId: string, groupId: string): boolean {
	if (node.type === "route") return false;
	if (node.projectId !== null && node.projectId !== projectId) return false;
	if (node.projectId === null && node.excludedGroups.includes(groupPair(projectId, groupId)))
		return false;
	return node.groupIds.length === 0 || node.groupIds.includes(groupId);
}

/**
 * Groups with enabled triggers and no healthy node — the failure #316 calls the
 * one that matters most.
 *
 * Under direct consumption there is no internal stream to inspect: the external
 * source just grows and nothing says so. So this is loud rather than a metric.
 * A group with no enabled trigger is silent — it has no work to be late with.
 */
export function groupAlarms(
	active: readonly ActiveGroup[],
	nodes: readonly NodeView[],
): GroupAlarm[] {
	const alarms: GroupAlarm[] = [];
	for (const group of active) {
		const claimed = nodes.filter((node) => covers(node, group.projectId, group.groupId));
		if (claimed.some((node) => node.serving)) continue;
		alarms.push({ ...group, claimedNodes: claimed.length });
	}
	return alarms;
}
