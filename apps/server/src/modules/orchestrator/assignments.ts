import { openKvBucket } from "@fluxify/common/nats";
import {
	NODE_ASSIGNMENT_BUCKET,
	orchestratorKeys,
	type NodeAssignment,
} from "@fluxify/common/orchestrator";
import { initializeNats } from "../../db/nats";

/**
 * What each node should be running, published for the node itself to read.
 *
 * This is the seam that lets a node's groups change without recreating its
 * container: the worker watches its own key and applies a new group list in
 * place (#336). A retype arrives the same way and the worker restarts itself,
 * because the consumers bound to its old type are already running.
 *
 * No TTL — a node restarting must find the same record it read before, or it
 * would fall back to its environment and quietly disagree with what the
 * reconciler believes it is doing.
 */
export interface Assignments {
	write(nodeId: string, assignment: NodeAssignment): Promise<void>;
	remove(nodeId: string): Promise<void>;
}

export async function openAssignments(): Promise<Assignments> {
	const nc = await initializeNats();
	const bucket = await openKvBucket<NodeAssignment>(nc, NODE_ASSIGNMENT_BUCKET);
	return {
		async write(nodeId, assignment) {
			await bucket.put(orchestratorKeys.assignment(nodeId), assignment);
		},
		async remove(nodeId) {
			await bucket.delete(orchestratorKeys.assignment(nodeId));
		},
	};
}
