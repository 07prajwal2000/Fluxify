import { groupPair } from "@fluxify/common/orchestrator";
import { db } from "../../db";
import { nodeClaimsEntity, triggerGroupsEntity } from "../../db/schema";
import { nodeEntitlement } from "../../lib/edition";
import { projectHost } from "../../lib/hosting";
import { orchestrationScalingSchema } from "../../lib/instance-settings/schemas";
import { baseDomain, getSetting } from "../../loaders/instanceSettingsLoader";
import { projectSubdomains } from "./claims";
import { type Claim, type DesiredNode, projectDesiredNodes } from "./projection";
import { type ScalingContext, scalingCeilings } from "./scaling";

/**
 * What should be running, read from Postgres every pass.
 *
 * The orchestrator computes this itself rather than being told, which is what
 * settles cold start: booting against an empty KV it rebuilds the whole picture
 * from the database instead of asking admin for it (§2). It reads claims, the
 * pool ceiling and the license, and writes none of them — admin owns those rows
 * and this process owns the node rows, in both directions.
 */

export interface PoolLimits {
	maxNodes: number;
}

export interface DesiredState {
	nodes: DesiredNode[];
	pool: PoolLimits;
	scaling: ScalingContext;
}

export async function readDesiredState(): Promise<DesiredState> {
	const claims = await db
		.select({
			id: nodeClaimsEntity.id,
			projectId: nodeClaimsEntity.projectId,
			type: nodeClaimsEntity.type,
			groupIds: nodeClaimsEntity.groupIds,
			replicas: nodeClaimsEntity.replicas,
			maxReplicas: nodeClaimsEntity.maxReplicas,
			metadata: nodeClaimsEntity.metadata,
			createdAt: nodeClaimsEntity.createdAt,
		})
		.from(nodeClaimsEntity);

	const groups = await db
		.select({ id: triggerGroupsEntity.id, projectId: triggerGroupsEntity.projectId })
		.from(triggerGroupsEntity);

	// A claim's group list is jsonb, so deleting a group leaves its id behind
	// with nothing to cascade it away. Passing what exists drops those.
	const knownGroups = new Set(groups.map((group) => groupPair(group.projectId, group.id)));

	// Absent means the operator has not sized the pool, which is a ceiling of
	// zero: claims are recorded and sit `pending` rather than being forced onto
	// a host nobody has declared capacity for.
	const pool: PoolLimits = getSetting("orchestration_pool") ?? { maxNodes: 0 };

	const entitlement = nodeEntitlement();
	const nodes = projectDesiredNodes({
		claims: claims as Claim[],
		maxNodes: pool.maxNodes,
		entitlement,
		knownGroups,
	});
	// Recomputed every pass rather than stored, so a license change or a shrunk
	// pool reaches every claim's ceiling without anyone editing a claim.
	const scaling: ScalingContext = {
		policy: orchestrationScalingSchema.parse(getSetting("orchestration_scaling") ?? {}),
		ceilings: scalingCeilings(claims, pool.maxNodes, entitlement),
	};
	// A pinned node serving APIs is reached on its project's own host, so the
	// host is part of what should be running: changing it replaces the node.
	const subdomains = await projectSubdomains();
	const domain = baseDomain();
	for (const node of nodes) {
		const subdomain = node.projectId && node.type !== "workflow" && subdomains.get(node.projectId);
		if (subdomain) node.host = projectHost(subdomain, domain);
	}
	return { nodes, pool, scaling };
}
