import { openKvBucket } from "@fluxify/common/nats";
import {
	NODE_ASSIGNMENT_BUCKET,
	type NodeAssignment,
	orchestratorKeys,
} from "@fluxify/common/orchestrator";
import { initializeNats } from "../../db/nats";

/**
 * What each claim's nodes should be running, published for the nodes to read.
 *
 * This is the seam that lets a node's groups change without recreating its
 * container: the worker watches its claim's key and applies a new group list in
 * place (#336). A retype arrives the same way and the worker restarts itself,
 * because the consumers bound to its old type are already running.
 *
 * One record per claim (#426). Every replica of a claim is identical by
 * construction, so a per-node key stored the same bytes `r` times — and a
 * Deployment names its own pods, so on Kubernetes there is no node name to key
 * by before the pod exists.
 *
 * No TTL — a node restarting must find the same record it read before, or it
 * would fall back to its environment and quietly disagree with what the
 * reconciler believes it is doing.
 */
export interface Assignments {
	write(claimId: string, assignment: NodeAssignment): Promise<void>;
	/**
	 * Drops every record except the claims named.
	 *
	 * A prune rather than a delete-per-removal: one replica going away must not
	 * take the record its siblings are still reading, so the only safe moment to
	 * delete is when the claim itself is gone from desired state. It also clears
	 * whatever an older build left behind, which is what makes the per-node keys
	 * this replaced disappear on the first pass after an upgrade.
	 */
	prune(keepClaimIds: ReadonlySet<string>): Promise<void>;
}

export async function openAssignments(): Promise<Assignments> {
	const nc = await initializeNats();
	const bucket = await openKvBucket<NodeAssignment>(nc, NODE_ASSIGNMENT_BUCKET);
	return {
		async write(claimId, assignment) {
			await bucket.put(orchestratorKeys.assignment(claimId), assignment);
		},
		async prune(keepClaimIds) {
			const keep = new Set([...keepClaimIds].map((id) => orchestratorKeys.assignment(id)));
			for (const key of await bucket.keys(orchestratorKeys.allAssignments)) {
				if (!keep.has(key)) await bucket.delete(key);
			}
		},
	};
}
