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
	/** Absent on a claim-level event: a claim is written before any node exists. */
	nodeId?: string | null;
	claimId: string;
	projectId: string | null;
	/** `created`, `removed`, `recreated`, `create_failed`, … */
	action: string;
	reason?: NodeReason | null;
	detail?: Record<string, unknown>;
}

export async function recordEvent(event: NodeEvent): Promise<void> {
	await db.insert(orchestrationEventsEntity).values({
		nodeId: event.nodeId ?? null,
		claimId: event.claimId,
		projectId: event.projectId,
		action: event.action,
		reason: event.reason ?? null,
		detail: event.detail ?? null,
	});
}

/** Waiting words that mean "on its way up", from Docker and from a pod. */
const STARTING = new Set(["created", "ContainerCreating", "PodInitializing", "Pending"]);
const PULL_FAILED = new Set(["ErrImagePull", "ImagePullBackOff", "InvalidImageName"]);
/** A pod no machine has room for: capacity, which is what the pool reason already says. */
const UNSCHEDULABLE = "Unschedulable";

/**
 * The state this node is in, as the platform reports it. `ready` here means the
 * container is running; whether it is actually serving is the `ready` flag in
 * its heartbeat, which the status surfaces join in (§14.5). Two sources for two
 * different questions rather than one guess about both.
 *
 * ponytail: on Kubernetes a claim's pods appear a moment after its Deployment,
 * so a new claim reads `failed` for one pass. Tell "not created yet" apart from
 * "cannot be created" with the Deployment's conditions if that flash matters.
 */
function nodeState(node: DesiredNode, container: ObservedNode | undefined): NodeState {
	if (!node.placeable) return container ? "ready" : "pending";
	if (!container) return "failed";
	if (container.running) return "ready";
	if (container.platformState === "terminating") return "stopping";
	if (container.platformState === UNSCHEDULABLE) return "pending";
	// Anything else — restarting, exited, crash-looping — is a container the
	// platform is already fighting with, and reporting that as `starting` would
	// leave a crash loop looking like a slow boot forever.
	return STARTING.has(container.platformState) ? "starting" : "failed";
}

/**
 * Why a row is in its state. The projection's reason wins when it has one (no
 * licence slot, no pool room); otherwise it is what the platform said about
 * the container.
 */
function nodeReason(
	node: DesiredNode,
	container: ObservedNode | undefined,
	state: NodeState,
): NodeReason | null {
	if (node.reason) return node.reason;
	if (container?.platformState === UNSCHEDULABLE) return "pool_unavailable";
	if (state !== "failed") return null;
	return container && PULL_FAILED.has(container.platformState)
		? "image_pull_failed"
		: "start_failed";
}

const position = (claimId: string, replicaIndex: number) => `${claimId}/${replicaIndex}`;

/**
 * Mirrors what should run, and what does, into the node table so admin can
 * read it.
 *
 * Rows are matched by position — claim and replica number — and take their id
 * from the node found there. On Docker that is `<claimId>.<replica>` either
 * way; on Kubernetes it is the pod name, which is what the pod heartbeats
 * under, so the row and its heartbeat join.
 *
 * A pod past the claim's floor is KEDA's, started for load within the ceiling
 * the claim set. It gets a row too, so everything that heartbeats is shown.
 * Docker never has one: anything past the floor there is an orphan and gone
 * before this runs.
 */
export async function syncNodeRows(
	desired: readonly DesiredNode[],
	observed: readonly ObservedNode[],
): Promise<void> {
	const byPosition = new Map(
		observed.map((container) => [position(container.claimId, container.replicaIndex), container]),
	);
	const firstOfClaim = new Map<string, DesiredNode>();
	const wanted = new Set<string>();
	const pairs: [DesiredNode, ObservedNode | undefined][] = [];

	for (const node of desired) {
		if (!firstOfClaim.has(node.claimId)) firstOfClaim.set(node.claimId, node);
		wanted.add(position(node.claimId, node.replicaIndex));
		pairs.push([node, byPosition.get(position(node.claimId, node.replicaIndex))]);
	}
	for (const container of observed) {
		const node = firstOfClaim.get(container.claimId);
		if (!node?.placeable || wanted.has(position(container.claimId, container.replicaIndex)))
			continue;
		pairs.push([{ ...node, replicaIndex: container.replicaIndex, reason: null }, container]);
	}

	const keep = new Set<string>();
	for (const [node, container] of pairs) {
		const id = container?.nodeId ?? nodeIdFor(node.claimId, node.replicaIndex);
		keep.add(id);
		const state = nodeState(node, container);
		const row = {
			id,
			claimId: node.claimId,
			replicaIndex: node.replicaIndex,
			projectId: node.projectId,
			type: node.type,
			groupIds: node.groupIds,
			excludedGroups: node.excludedGroups,
			state,
			reason: nodeReason(node, container, state),
			image: container?.image ?? null,
			containerId: container?.containerId ?? null,
		};
		await db
			.insert(workerNodesEntity)
			.values(row)
			.onConflictDoUpdate({ target: workerNodesEntity.id, set: row });
	}

	// Rows for nodes nobody asks for any more, and pods that were replaced. A
	// deleted claim cascades its rows away on its own.
	const existing = await db.select({ id: workerNodesEntity.id }).from(workerNodesEntity);
	const stale = existing.map((row) => row.id).filter((id) => !keep.has(id));
	if (stale.length) {
		await db.delete(workerNodesEntity).where(inArray(workerNodesEntity.id, stale));
	}
}
