import { CATCH_ALL } from "@fluxify/common/orchestrator";
import { nodeIdFor } from "./containerSpec";
import type { DesiredNode } from "./projection";

/**
 * What to do about the difference between what should be running and what is.
 *
 * Pure, and the whole decision lives here: `docker.ts` performs actions without
 * choosing any, and the reconciler reads state and writes rows. A controller
 * that decides and acts in the same breath is a controller nobody can test
 * without a daemon.
 *
 * The direction is fixed: actual → desired, never the inverse (§2). Desired
 * state inferred from what happens to be running cannot correct drift and
 * cannot rebuild anything after a wipe.
 */

/** A container carrying this orchestrator's label, as Docker reports it. */
export interface ObservedNode {
	containerId: string;
	/** From the node label. The identity both sides agree on. */
	nodeId: string;
	claimId: string;
	replicaIndex: number;
	/** Null for a catch-all node, matching the desired shape. */
	projectId: string | null;
	image: string;
	running: boolean;
	/**
	 * What the platform calls this container: `running`, `created`,
	 * `restarting`, `exited`, … Kept as well as `running` because a container
	 * that keeps crashing and being restarted is not the same condition as one
	 * that is still starting up, and only the platform can tell them apart.
	 */
	platformState: string;
}

export type RemoveReason =
	/** Carries the label but nothing wants it — the claim or a replica went away. */
	| "orphan"
	/** The operator shrank the pool below what is running. */
	| "pool_unavailable"
	/** Its immutable settings changed, so it is replaced rather than adjusted. */
	| "replaced";

export type PlanAction =
	| { kind: "create"; node: DesiredNode }
	| { kind: "remove"; container: ObservedNode; reason: RemoveReason }
	| { kind: "recreate"; node: DesiredNode; container: ObservedNode; why: string };

/**
 * What forces a replacement rather than an update. Type and groups are
 * deliberately absent: those travel through the assignment record the node
 * watches (§4), which is the entire point of having a seam. The project is here
 * because it is baked into the container's env and its Traefik labels, and
 * labels cannot be changed on a running container.
 */
function immutableDrift(node: DesiredNode, container: ObservedNode, image: string) {
	if (container.image !== image) return `image ${container.image} → ${image}`;
	if ((container.projectId ?? CATCH_ALL) !== (node.projectId ?? CATCH_ALL)) {
		return `project ${container.projectId ?? CATCH_ALL} → ${node.projectId ?? CATCH_ALL}`;
	}
	return null;
}

export function planReconcile(
	desired: readonly DesiredNode[],
	observed: readonly ObservedNode[],
	options: { image: string },
): PlanAction[] {
	const running = new Map(observed.map((container) => [container.nodeId, container]));
	const creates: PlanAction[] = [];
	const changes: PlanAction[] = [];
	const removals: PlanAction[] = [];
	const wanted = new Set<string>();

	for (const node of desired) {
		const nodeId = nodeIdFor(node.claimId, node.replicaIndex);
		wanted.add(nodeId);
		const container = running.get(nodeId);

		if (!node.placeable) {
			// A license that lapsed or was downgraded does NOT take running
			// containers away (§12): existing infra keeps serving and only a
			// restart is refused, so a billing hiccup never kills live traffic.
			// A shrunken pool is the operator's own decision, so that one is acted
			// on.
			if (container && node.reason === "pool_unavailable") {
				removals.push({ kind: "remove", container, reason: "pool_unavailable" });
			}
			continue;
		}

		if (!container) {
			creates.push({ kind: "create", node });
			continue;
		}
		const why = immutableDrift(node, container, options.image);
		if (why) changes.push({ kind: "recreate", node, container, why });
	}

	for (const container of observed) {
		if (!wanted.has(container.nodeId)) {
			removals.push({ kind: "remove", container, reason: "orphan" });
		}
	}

	// Removals first: they free the license slots and the pool room that the
	// creates in the same pass are about to ask for.
	return [...removals, ...changes, ...creates];
}
