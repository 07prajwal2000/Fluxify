/**
 * The orchestrator's shared vocabulary: what a node is, what state it can be
 * in, and where its ephemeral state lives in NATS KV.
 *
 * It sits in `common` because three processes need it and none of them may
 * depend on the others — the worker claims a license slot and writes heartbeats
 * (#336), the orchestrator reconciles (#337), and admin reads both back for the
 * UI (#339). A key name invented twice is a key name that eventually disagrees.
 *
 * Nothing here touches Postgres, Docker or the license: it is names and types.
 */

/** What a node runs. `both` is one container doing either job. */
export const NODE_TYPES = ["route", "workflow", "both"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Every condition a node can be displayed in (§14.4). A container observed but
 * absent from desired state is an orphan the reconciler deletes, so it needs no
 * state of its own.
 */
export const NODE_STATES = [
	/** Desired but not placed — no pool capacity, no license slot. */
	"pending",
	/** Created, not yet ready. */
	"starting",
	/** Running and serving. */
	"ready",
	/** Running, but the heartbeat is stale or the probe fails. */
	"unhealthy",
	/** Draining before removal. */
	"stopping",
	/** Exited non-zero, or never started. */
	"failed",
] as const;
export type NodeState = (typeof NODE_STATES)[number];

/**
 * Why a node is in its state. Shown to a person, so each one has to read as an
 * action they could take. Billing never appears here (§3) — a withdrawn pool or
 * a paused VM arrives as `pool_unavailable`.
 */
export const NODE_REASONS = [
	/** The declared node ceiling is reached. On Docker that is the only capacity notion there is. */
	"pool_unavailable",
	/** Every license slot is taken — replicas consume one each (§7). */
	"no_license_slot",
	/** The tier does not permit this claim: its type, or naming a project at all. */
	"not_licensed",
	/** The image could not be pulled — the common real failure on Docker. */
	"image_pull_failed",
	/** The container was created but exited before becoming ready. */
	"start_failed",
	/** No heartbeat within the bucket TTL, so the process is gone or partitioned. */
	"heartbeat_stale",
	/** Draining on purpose: a released claim, or a replica count scaled down. */
	"draining",
] as const;
export type NodeReason = (typeof NODE_REASONS)[number];

/**
 * Liveness and license slots. TTL'd, because expiry *is* the mechanism: a node
 * that stops renewing is gone, and its slot frees itself with no cleanup pass
 * to get wrong.
 *
 * The slot key and the heartbeat key are deliberately the same key (§7). Two
 * keys with the same lifetime could disagree about whether a node exists, and a
 * license slot that outlives its node is a slot nobody can ever reclaim.
 */
export const NODE_LIVENESS_BUCKET = "fluxify_node_liveness";
export const NODE_LIVENESS_TTL_MS = 30_000;

/**
 * The leader lease, in its own bucket only because TTL is a bucket property
 * rather than a key one. It wants a much shorter TTL than a heartbeat: this is
 * how long a dead orchestrator blocks its standby, whereas a node's TTL is how
 * long a live node may be silent before it looks dead.
 */
export const ORCHESTRATOR_LEASE_BUCKET = "fluxify_orchestrator_lease";
export const ORCHESTRATOR_LEASE_TTL_MS = 10_000;

/** Every key either side writes. The one place these are spelled. */
export const orchestratorKeys = {
	/** Heartbeat and license slot for one node, in `NODE_LIVENESS_BUCKET`. */
	node: (nodeId: string) => `node.${nodeId}`,
	/** Filter matching every node key, for a watch or a slot count. */
	allNodes: "node.>",
	/** The single leader lease, in `ORCHESTRATOR_LEASE_BUCKET`. */
	leader: "leader",
	/**
	 * Desired state for one project, in the shared config bucket under the
	 * orchestrator's prefix. Keyed per project rather than one global blob so
	 * sharding later is "which prefixes does this replica own" — a config
	 * change, not a data migration (§9). `CATCH_ALL` holds the `*` nodes.
	 */
	desired: (projectId: string) => `desired.${projectId}`,
	desiredAll: "desired.>",
} as const;

/** The config-store prefix the orchestrator publishes desired state under. */
export const ORCHESTRATOR_CONFIG_PREFIX = "orchestrator";

/**
 * Stands in for a project id on a claim that serves every project, so a key
 * built from one is never empty. In Postgres the same thing is a null
 * `project_id`; in a worker's environment it is `WORKER_PROJECT_ID=*`.
 */
export const CATCH_ALL = "*";

/** What a worker writes to its liveness key. Read by admin for the UI. */
export interface NodeHeartbeat {
	nodeId: string;
	/** The claim this node is a replica of. Absent for an unmanaged worker. */
	claimId?: string;
	projectId: string;
	type: NodeType;
	groupIds: string[];
	/** Set once the worker is serving, so admin can tell starting from ready. */
	ready: boolean;
	/** ISO timestamp of this renewal. */
	at: string;
}

/**
 * What a license tier permits a project to claim. Derived from the license the
 * admin already publishes (`lib/edition.ts`), never stored — so a renewal or an
 * expiry takes effect without anyone writing a row.
 */
export interface NodeEntitlement {
	/**
	 * Replicas the license permits across the whole instance, counting every
	 * claim — a replica is a container and each one consumes a slot (§7). Null
	 * means the license sets no limit and the pool ceiling is the only one.
	 */
	maxReplicas: number | null;
	/** Node types a claim may ask for. */
	types: readonly NodeType[];
	/** Whether a claim may name a single project, or only the catch-all. */
	perProject: boolean;
}
