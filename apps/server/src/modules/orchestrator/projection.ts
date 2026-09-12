import {
	groupPair,
	type NodeEntitlement,
	type NodeReason,
	type NodeType,
} from "@fluxify/common/orchestrator";

export { groupPair };

/**
 * Desired state: the containers that should exist, projected from the claims
 * that asked for them.
 *
 * **This is a projection, not a scheduler.** A claim names its project, its
 * type and its groups, and its replicas are identical, so satisfying one is
 * "create a container with these values" rather than a choice among
 * candidates. There is no bin-packing, no load-based selection, no stickiness
 * to preserve, and nothing ever moves. Load-based placement would have nothing
 * to act on anyway: Docker reports a container's *limits*, not what its loaded
 * workflows consume.
 *
 * Everything here is pure — no database, no Docker, no clock. The reconciler
 * (#337) calls it with rows it has already read and diffs the result against
 * what is actually running.
 */

/** A row from `node_claims`. `projectId: null` is the catch-all (`*`). */
export interface Claim {
	id: string;
	projectId: string | null;
	type: NodeType;
	groupIds: string[];
	replicas: number;
	createdAt: Date;
}

/**
 * One container that should exist. `(claimId, replicaIndex)` is its identity —
 * stable without storing a placement decision, because no decision was made.
 */
export interface DesiredNode {
	claimId: string;
	replicaIndex: number;
	projectId: string | null;
	type: NodeType;
	groupIds: string[];
	/** Populated only for a catch-all node: `project:group` pairs a dedicated claim owns. */
	excludedGroups: string[];
	/** False when nothing can be created yet: the node is `pending` with `reason`. */
	placeable: boolean;
	reason: NodeReason | null;
}

export interface ProjectionInput {
	claims: Claim[];
	/** The instance's node ceiling, from `orchestration_pool`. */
	maxNodes: number;
	entitlement: NodeEntitlement;
	/**
	 * Every trigger group that currently exists, as `project:group`. Optional:
	 * pass it to drop ids left behind by a deleted group, which a jsonb list
	 * cannot cascade away. A claim whose groups have all been deleted is still a
	 * node — the user asked for one, and a group is created into it later.
	 */
	knownGroups?: ReadonlySet<string>;
}

const SERVES_WORKFLOWS: readonly NodeType[] = ["workflow", "both"];

/**
 * Groups a dedicated claim already owns, which a catch-all node must not also
 * serve — otherwise two nodes consume the same group and the operator has no
 * way to tell which one is doing the work.
 *
 * An exclusion list rather than a positive one, so a group created tomorrow
 * falls to the catch-all with nothing to update. That is what a catch-all is
 * for.
 */
function exclusions(claims: Claim[]): string[] {
	const pairs = new Set<string>();
	for (const claim of claims) {
		if (claim.projectId === null || !SERVES_WORKFLOWS.includes(claim.type)) continue;
		if (claim.replicas < 1) continue;
		for (const groupId of claim.groupIds) pairs.add(groupPair(claim.projectId, groupId));
	}
	return [...pairs].sort();
}

/** Why the license refuses a claim outright, before any counting. */
function licenseRefusal(claim: Claim, entitlement: NodeEntitlement): NodeReason | null {
	if (!entitlement.types.includes(claim.type)) return "not_licensed";
	if (claim.projectId !== null && !entitlement.perProject) return "not_licensed";
	return null;
}

export function projectDesiredNodes({
	claims,
	maxNodes,
	entitlement,
	knownGroups,
}: ProjectionInput): DesiredNode[] {
	const catchAllExclusions = exclusions(claims);
	// Oldest claim first, so which replicas get the last free slot does not
	// change between runs — an unstable order would have the reconciler create
	// and destroy the same containers forever.
	const ordered = [...claims].sort(
		(a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
	);

	const nodes: DesiredNode[] = [];
	let placed = 0;

	for (const claim of ordered) {
		const refusal = licenseRefusal(claim, entitlement);
		const groupIds = SERVES_WORKFLOWS.includes(claim.type)
			? claim.groupIds.filter(
					(id) => !knownGroups || knownGroups.has(groupPair(claim.projectId, id)),
				)
			: [];

		for (let replicaIndex = 0; replicaIndex < claim.replicas; replicaIndex++) {
			// A claim the license refuses still shows its replicas as pending:
			// requested ≠ current is a state to display, not drift to correct.
			const reason =
				refusal ??
				(entitlement.maxReplicas !== null && placed >= entitlement.maxReplicas
					? "no_license_slot"
					: placed >= maxNodes
						? "pool_unavailable"
						: null);
			if (reason === null) placed++;

			nodes.push({
				claimId: claim.id,
				replicaIndex,
				projectId: claim.projectId,
				type: claim.type,
				groupIds,
				excludedGroups: claim.projectId === null ? catchAllExclusions : [],
				placeable: reason === null,
				reason,
			});
		}
	}

	return nodes;
}

/**
 * Whether a claim may be written at all. Called by the admin API (#339) so a
 * refusal reaches the person making it, rather than being placed and left
 * broken for the reconciler to explain.
 *
 * `hasSubdomain` comes from the project's settings (#340): a route node is
 * reached by a per-project `Host` rule, so without a subdomain there is nothing
 * to route to it and the node would serve no traffic at all.
 */
export function validateClaim(
	claim: Pick<Claim, "projectId" | "type" | "groupIds" | "replicas">,
	context: {
		entitlement: NodeEntitlement;
		/** Replicas already claimed instance-wide, excluding the claim being written. */
		existingReplicas: number;
		hasSubdomain: boolean;
	},
): { ok: true } | { ok: false; message: string } {
	const { entitlement, existingReplicas, hasSubdomain } = context;
	const refuse = (message: string) => ({ ok: false as const, message });

	if (claim.replicas < 1) return refuse("A claim needs at least one replica");
	if (!entitlement.types.includes(claim.type))
		return refuse(`This license does not allow a '${claim.type}' node`);
	if (claim.projectId !== null && !entitlement.perProject)
		return refuse("This license only allows nodes that serve every project");
	// Only a project-pinned claim must name its groups. On a catch-all, no
	// groups means every group no dedicated node owns — which is the default
	// deployment shape, and what a worker with no `WORKER_GROUP_ID` has always
	// done.
	if (claim.projectId !== null && SERVES_WORKFLOWS.includes(claim.type) && claim.groupIds.length === 0)
		return refuse("A workflow node for a single project needs at least one trigger group");
	if (claim.type !== "workflow" && !hasSubdomain)
		return refuse(
			"This project needs a subdomain before it can claim a route node — without one there is no way to route traffic to it",
		);

	if (
		entitlement.maxReplicas !== null &&
		existingReplicas + claim.replicas > entitlement.maxReplicas
	)
		return refuse(
			`This license allows ${entitlement.maxReplicas} node(s) in total, and ${existingReplicas} are already claimed`,
		);

	// The pool ceiling is deliberately not checked here. A claim past it is
	// recorded and sits `pending` / `pool_unavailable`, which is what tells the
	// operator to grow the pool — refusing it would hide the request instead.
	return { ok: true };
}
