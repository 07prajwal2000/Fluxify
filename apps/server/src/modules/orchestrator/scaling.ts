import type { NodeEntitlement } from "@fluxify/common/orchestrator";
import type { ScalingPolicy } from "../../lib/instance-settings/schemas";
import type { ExternalTrigger } from "./kubernetesSpec";
import { byAge, type Claim } from "./projection";

/**
 * Autoscaling, as numbers only (#428). A claim's `replicas` is its floor and
 * `maxReplicas` how far it may grow; the instance's scaling policy says what
 * "busy" means. Nothing here knows which platform runs the nodes: Kubernetes
 * hands these numbers to KEDA, and a driver without an autoscaler of its own
 * calls `desiredReplicas` itself. One policy, whoever executes it.
 */

export type { ScalingPolicy };

/** What a pass hands the driver: the instance policy and each claim's real ceiling. */
export interface ScalingContext {
	policy: ScalingPolicy;
	/** Claim id → the most nodes it may run this pass. Equal to its floor when it does not scale. */
	ceilings: ReadonlyMap<string, number>;
	/**
	 * Group id → its active internal triggers with a workflow attached: the ones
	 * with a consumer on the trigger stream, whose backlog is a scaling signal.
	 */
	triggersByGroup: ReadonlyMap<string, readonly string[]>;
	/** Group id → its active triggers on an outside queue that KEDA can watch. */
	externalByGroup: ReadonlyMap<string, readonly ExternalTrigger[]>;
}

/** How many nodes a queue of `pending` messages asks for, clamped to `[min, max]`. */
export function desiredReplicas({
	pending,
	threshold,
	min,
	max,
}: {
	pending: number;
	threshold: number;
	min: number;
	max: number;
}): number {
	const wanted = Math.ceil(Math.max(0, pending) / threshold);
	// The floor wins over a ceiling below it: a claim never runs under what it asked for.
	return Math.max(min, Math.min(max, wanted));
}

type ScalableClaim = Pick<Claim, "id" | "replicas" | "createdAt" | "maxReplicas">;

/**
 * The ceiling each claim may grow to — never simply the number the user typed.
 *
 * A capped license (community, non-commercial) runs a fixed number of nodes,
 * and a node started past it exits on boot, so nothing grows there. Otherwise
 * the pool's room above every claim's floor is handed out oldest claim first,
 * the same order the projection places them in: two claims both told "the
 * spare room is yours" could together run past the pool.
 *
 * ponytail: oldest-first means a newer claim may get no room to grow at all
 * while an older one idles at its floor. Rebalance on observed load if that
 * ever matters in practice.
 */
export function scalingCeilings(
	claims: readonly ScalableClaim[],
	maxNodes: number,
	entitlement: NodeEntitlement,
): Map<string, number> {
	const floors = claims.reduce((sum, claim) => sum + claim.replicas, 0);
	let spare = entitlement.maxReplicas === null ? Math.max(0, maxNodes - floors) : 0;

	const ceilings = new Map<string, number>();
	for (const claim of [...claims].sort(byAge)) {
		const growth = Math.min(Math.max(0, (claim.maxReplicas ?? 0) - claim.replicas), spare);
		spare -= growth;
		ceilings.set(claim.id, claim.replicas + growth);
	}
	return ceilings;
}

/** Why a claim's maximum cannot be written, or null. Called beside `validateClaim`. */
export function scalingRefusal(
	claim: Pick<Claim, "replicas" | "maxReplicas">,
	entitlement: NodeEntitlement,
): string | null {
	if (claim.maxReplicas == null) return null;
	if (claim.maxReplicas < claim.replicas)
		return `The maximum (${claim.maxReplicas}) cannot be below the replica count (${claim.replicas})`;
	if (entitlement.maxReplicas !== null && claim.maxReplicas > claim.replicas)
		return "This license runs a fixed number of nodes, so a claim cannot grow past its replica count";
	return null;
}
