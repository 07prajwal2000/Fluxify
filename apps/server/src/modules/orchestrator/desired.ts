import { groupPair } from "@fluxify/common/orchestrator";
import { db } from "../../db";
import { nodeClaimsEntity, triggerGroupsEntity } from "../../db/schema";
import { nodeEntitlement } from "../../lib/edition";
import { getSetting } from "../../loaders/instanceSettingsLoader";
import { projectDesiredNodes, type Claim, type DesiredNode } from "./projection";

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
	cpuPerNode?: number;
	memoryPerNodeMb?: number;
}

export interface DesiredState {
	nodes: DesiredNode[];
	pool: PoolLimits;
}

export async function readDesiredState(): Promise<DesiredState> {
	const claims = await db
		.select({
			id: nodeClaimsEntity.id,
			projectId: nodeClaimsEntity.projectId,
			type: nodeClaimsEntity.type,
			groupIds: nodeClaimsEntity.groupIds,
			replicas: nodeClaimsEntity.replicas,
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

	return {
		nodes: projectDesiredNodes({
			claims: claims as Claim[],
			maxNodes: pool.maxNodes,
			entitlement: nodeEntitlement(),
			knownGroups,
		}),
		pool,
	};
}
