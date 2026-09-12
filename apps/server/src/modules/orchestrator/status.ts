import { logger } from "@fluxify/common";
import { openKvBucket } from "@fluxify/common/nats";
import {
	NODE_LIVENESS_BUCKET,
	NODE_LIVENESS_TTL_MS,
	ORCHESTRATOR_LEASE_BUCKET,
	ORCHESTRATOR_LEASE_TTL_MS,
	orchestratorKeys,
	type InfraProvider,
	type NodeEntitlement,
	type NodeHeartbeat,
	type ObservedInventory,
	type ObservedNode,
	type OrchestratorLease,
} from "@fluxify/common/orchestrator";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { initializeNats } from "../../db/nats";
import {
	nodeClaimsEntity,
	orchestrationEventsEntity,
	triggerGroupsEntity,
	triggersEntity,
	workerNodesEntity,
} from "../../db/schema";
import { nodeEntitlement } from "../../lib/edition";
import { hasSubdomain } from "./claims";
import { readDesiredState } from "./desired";
import {
	buildClaimViews,
	groupAlarms,
	poolUsage,
	type ActiveGroup,
	type ClaimView,
	type GroupAlarm,
	type Heartbeat,
} from "./statusView";

/**
 * What admin reads back for the two status surfaces (#339).
 *
 * It runs the same projection the reconciler does (`readDesiredState`) rather
 * than reading node rows alone. That matters on a stack where no orchestrator
 * has ever run — Kit, or a production stack before the first pass — where
 * there are no rows at all and the honest answer is still "these are the nodes
 * your claims ask for, none of them placed yet".
 */

export interface OrchestratorInfo {
	/** False when no lease is held: nothing is reconciling, so nothing will change. */
	alive: boolean;
	/** Null when nothing is running — the UI must not guess a provider nobody reported. */
	provider: InfraProvider | null;
	holder: string | null;
	at: string | null;
	reconcileIntervalMs: number | null;
	meta: Record<string, string | number | boolean>;
}

export interface OrchestrationStatus {
	orchestrator: OrchestratorInfo;
	pool: {
		placed: number;
		requested: number;
		ceiling: number;
		cpuPerNode?: number;
		memoryPerNodeMb?: number;
	};
	entitlement: NodeEntitlement;
	/**
	 * Whether a claim that serves APIs can be written here at all. A project
	 * needs a subdomain to be routed to (#340); a catch-all claim is reached on
	 * `PathPrefix(/)` and needs nothing. The UI says so instead of offering a
	 * control whose only outcome is a refusal.
	 */
	canClaimRoutes: boolean;
	claims: ClaimView[];
	/**
	 * Claims that serve every project, on the project surface only. Context a
	 * project owner cannot change — but not context they can be denied: a
	 * catch-all node may well be the one running this project's workflows, and
	 * a container with no claim visible anywhere is a container nobody can
	 * explain.
	 */
	sharedClaims: ClaimView[];
	alarms: GroupAlarm[];
	/**
	 * Every labelled container the acting orchestrator saw on its last pass,
	 * instance surface only. This is the one thing desired state cannot answer:
	 * a container no claim asks for is absent from the projection by
	 * definition — an orphan mid-removal, or one left by a claim that is already
	 * gone — and it is exactly what an operator would otherwise open the Docker
	 * CLI to find.
	 *
	 * Empty when no orchestrator holds the lease: nothing is reporting, and
	 * inventing an inventory nobody published would be worse than saying so.
	 */
	host: HostInventory;
}

export interface HostInventory {
	/** When the orchestrator last looked. Null when nothing is reporting. */
	at: string | null;
	nodes: HostNodeView[];
}

export interface HostNodeView extends ObservedNode {
	/** False means no claim asks for this container — the reconciler will remove it. */
	claimed: boolean;
}

/**
 * The live nodes, from the KV bucket whose TTL *is* the liveness mechanism. A
 * broker that cannot be reached returns an empty map rather than throwing: the
 * page then shows every node as not-live, which is closer to the truth than a
 * 500 and lets the rest of the status render.
 */
async function readHeartbeats(): Promise<Map<string, Heartbeat>> {
	const beats = new Map<string, Heartbeat>();
	try {
		const nc = await initializeNats();
		const bucket = await openKvBucket<NodeHeartbeat>(nc, NODE_LIVENESS_BUCKET, {
			ttlMs: NODE_LIVENESS_TTL_MS,
		});
		const keys = await bucket.keys(orchestratorKeys.allNodes);
		for (const key of keys) {
			const beat = await bucket.get(key);
			if (beat) beats.set(beat.nodeId, { ready: beat.ready, at: beat.at });
		}
	} catch (error) {
		logger.warn(`could not read node liveness: ${String(error)}`, "ORCHESTRATOR.status");
	}
	return beats;
}

/** Who is reconciling, and what they are driving. Absent means nobody. */
async function readOrchestrator(): Promise<OrchestratorInfo> {
	const absent: OrchestratorInfo = {
		alive: false,
		provider: null,
		holder: null,
		at: null,
		reconcileIntervalMs: null,
		meta: {},
	};
	try {
		const nc = await initializeNats();
		const bucket = await openKvBucket<OrchestratorLease>(nc, ORCHESTRATOR_LEASE_BUCKET, {
			ttlMs: ORCHESTRATOR_LEASE_TTL_MS,
		});
		const lease = await bucket.get(orchestratorKeys.leader);
		if (!lease) return absent;
		return {
			alive: true,
			provider: lease.provider,
			holder: lease.holder,
			at: lease.at,
			reconcileIntervalMs: lease.reconcileIntervalMs,
			meta: lease.meta ?? {},
		};
	} catch (error) {
		logger.warn(`could not read the orchestrator lease: ${String(error)}`, "ORCHESTRATOR.status");
		return absent;
	}
}

/**
 * What the acting orchestrator last saw on the host. Absent — no lease, no
 * pass yet, an unreachable broker — reads as "nothing reported" rather than
 * "nothing running", which the UI says in those words.
 */
async function readObserved(): Promise<{ at: string | null; nodes: ObservedNode[] }> {
	try {
		const nc = await initializeNats();
		const bucket = await openKvBucket<ObservedInventory>(nc, ORCHESTRATOR_LEASE_BUCKET, {
			ttlMs: ORCHESTRATOR_LEASE_TTL_MS,
		});
		const inventory = await bucket.get(orchestratorKeys.observed);
		return { at: inventory?.at ?? null, nodes: inventory?.nodes ?? [] };
	} catch (error) {
		logger.warn(`could not read the host inventory: ${String(error)}`, "ORCHESTRATOR.status");
		return { at: null, nodes: [] };
	}
}

/** Groups with at least one enabled trigger — the only ones that can fall behind. */
async function readActiveGroups(projectId?: string): Promise<ActiveGroup[]> {
	const rows = await db
		.select({
			projectId: triggerGroupsEntity.projectId,
			groupId: triggerGroupsEntity.id,
			groupName: triggerGroupsEntity.name,
			activeTriggers: sql<number>`count(${triggersEntity.id})::int`,
		})
		.from(triggersEntity)
		.innerJoin(triggerGroupsEntity, eq(triggersEntity.groupId, triggerGroupsEntity.id))
		.where(
			projectId
				? and(eq(triggersEntity.active, true), eq(triggerGroupsEntity.projectId, projectId))
				: eq(triggersEntity.active, true),
		)
		.groupBy(triggerGroupsEntity.projectId, triggerGroupsEntity.id, triggerGroupsEntity.name);
	return rows;
}

export async function readOrchestrationStatus(projectId?: string): Promise<OrchestrationStatus> {
	const [{ nodes: desired, pool }, orchestrator, heartbeats, active, observed] = await Promise.all([
		readDesiredState(),
		readOrchestrator(),
		readHeartbeats(),
		readActiveGroups(projectId),
		// The project surface does not get this: a project owner has no business
		// with containers belonging to other projects, and nothing they could do
		// about one either way.
		projectId ? Promise.resolve({ at: null, nodes: [] }) : readObserved(),
	]);

	const claims = await db
		.select({
			id: nodeClaimsEntity.id,
			projectId: nodeClaimsEntity.projectId,
			type: nodeClaimsEntity.type,
			groupIds: nodeClaimsEntity.groupIds,
			replicas: nodeClaimsEntity.replicas,
			createdAt: nodeClaimsEntity.createdAt,
			createdBy: nodeClaimsEntity.createdBy,
		})
		.from(nodeClaimsEntity)
		.orderBy(nodeClaimsEntity.createdAt);

	const rows = await db
		.select({
			id: workerNodesEntity.id,
			claimId: workerNodesEntity.claimId,
			replicaIndex: workerNodesEntity.replicaIndex,
			projectId: workerNodesEntity.projectId,
			state: workerNodesEntity.state,
			reason: workerNodesEntity.reason,
			image: workerNodesEntity.image,
			containerId: workerNodesEntity.containerId,
			updatedAt: workerNodesEntity.updatedAt,
		})
		.from(workerNodesEntity);

	// Every claim is viewed, then narrowed: the alarm has to see catch-all nodes
	// to know whether a project's groups are covered, so scoping the projection
	// itself would make a project page report alarms it does not have.
	const all = buildClaimViews({ claims, desired, rows, heartbeats });
	const everyNode = all.flatMap((claim) => claim.nodes);
	const visible = projectId ? all.filter((claim) => claim.projectId === projectId) : all;

	return {
		orchestrator,
		pool: {
			...poolUsage(desired, pool.maxNodes),
			cpuPerNode: pool.cpuPerNode,
			memoryPerNodeMb: pool.memoryPerNodeMb,
		},
		entitlement: nodeEntitlement(),
		canClaimRoutes: projectId ? await hasSubdomain(projectId) : true,
		claims: visible,
		sharedClaims: projectId ? all.filter((claim) => claim.projectId === null) : [],
		alarms: groupAlarms(active, everyNode),
		host: {
			at: observed.at,
			nodes: observed.nodes.map((container) => ({
				...container,
				claimed: everyNode.some((node) => node.id === container.nodeId),
			})),
		},
	};
}

export interface EventView {
	id: number;
	nodeId: string | null;
	claimId: string | null;
	projectId: string | null;
	action: string;
	reason: string | null;
	detail: Record<string, unknown> | null;
	createdAt: string;
}

/**
 * What the orchestrator has done, newest first. Rows outlive the nodes they
 * describe — the interesting events are the removals — so this is the only
 * place a node that no longer exists can still be accounted for.
 *
 * A project's history includes the catch-all claims (`project_id is null`) as
 * well as its own. Those are what run its work when it holds no nodes of its
 * own, so leaving them out is what makes a container appear on this page with
 * nothing that explains it.
 */
export async function readOrchestrationEvents(options: {
	projectId?: string;
	limit?: number;
}): Promise<EventView[]> {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
	const rows = await db
		.select()
		.from(orchestrationEventsEntity)
		.where(
			options.projectId
				? or(
						eq(orchestrationEventsEntity.projectId, options.projectId),
						isNull(orchestrationEventsEntity.projectId),
					)
				: undefined,
		)
		.orderBy(desc(orchestrationEventsEntity.createdAt))
		.limit(limit);
	return rows.map((row) => ({
		id: row.id,
		nodeId: row.nodeId,
		claimId: row.claimId,
		projectId: row.projectId,
		action: row.action,
		reason: row.reason,
		detail: row.detail,
		createdAt: row.createdAt.toISOString(),
	}));
}
