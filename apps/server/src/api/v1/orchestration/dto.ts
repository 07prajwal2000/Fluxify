import {
	INFRA_PROVIDERS,
	NODE_REASONS,
	NODE_STATES,
	NODE_TYPES,
} from "@fluxify/common/orchestrator";
import z from "zod";
import {
	claimMetadataSchema,
	claimResourcesSchema,
} from "../../../modules/orchestrator/claimMetadata";

/**
 * The wire shape both status surfaces read (#339), in one file because they read
 * the same thing from two scopes: a project owner sees the claims they can
 * change, an operator sees every claim and the pool they all fit in (§14.5).
 *
 * The portal imports these types, so nothing server-only belongs here.
 */

export const nodeViewSchema = z.object({
	/** The heartbeat key: `<claimId>.<replicaIndex>` on Docker, the pod name on Kubernetes. */
	id: z.string(),
	claimId: z.string(),
	replicaIndex: z.number().int(),
	/** Null is the catch-all: this node serves every project. */
	projectId: z.string().nullable(),
	type: z.enum(NODE_TYPES),
	groupIds: z.array(z.string()),
	excludedGroups: z.array(z.string()),
	state: z.enum(NODE_STATES),
	reason: z.enum(NODE_REASONS).nullable(),
	image: z.string().nullable(),
	containerId: z.string().nullable(),
	/** A heartbeat arrived within its TTL — the process is alive. */
	live: z.boolean(),
	/** The worker says it is serving traffic, not merely running. */
	serving: z.boolean(),
	lastHeartbeatAt: z.string().nullable(),
	/** When the orchestrator last wrote this node's row. */
	observedAt: z.string().nullable(),
	/** Above the claim's floor: added by the autoscaler for load. */
	autoscaled: z.boolean(),
});

/** A trigger group a claim names, resolved — the instance surface spans every
 * project, so an id alone is unreadable there. `projectId` is what the page
 * links to so the groups are edited where they belong. */
export const claimGroupSchema = z.object({
	id: z.string(),
	name: z.string(),
	projectId: z.string().nullable(),
});

export const claimViewSchema = z.object({
	id: z.string(),
	projectId: z.string().nullable(),
	type: z.enum(NODE_TYPES),
	groupIds: z.array(z.string()),
	groups: z.array(claimGroupSchema),
	replicas: z.number().int(),
	/** How far the claim may autoscale. Null runs exactly `replicas`. */
	maxReplicas: z.number().int().nullable().optional(),
	/** Optional settings, with every default filled in — `resources` is always present. */
	metadata: claimMetadataSchema.extend({ resources: claimResourcesSchema }).optional(),
	createdAt: z.string(),
	createdBy: z.string().nullable().optional(),
	nodes: z.array(nodeViewSchema),
});

/**
 * What is driving the infrastructure. `provider` decides which panels the UI
 * shows, and `meta` is rendered as-is — a Docker endpoint and a Kubernetes
 * namespace are both just facts about the thing that is running.
 */
export const orchestratorInfoSchema = z.object({
	alive: z.boolean(),
	provider: z.enum(INFRA_PROVIDERS).nullable(),
	holder: z.string().nullable(),
	at: z.string().nullable(),
	reconcileIntervalMs: z.number().nullable(),
	meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const groupAlarmSchema = z.object({
	projectId: z.string(),
	groupId: z.string(),
	groupName: z.string(),
	activeTriggers: z.number().int(),
	/** Nodes that would serve it if one were healthy. Zero means nothing claims it. */
	claimedNodes: z.number().int(),
});

/** One container the orchestrator found carrying its label. */
export const hostNodeSchema = z.object({
	/** Container id on Docker, pod name on Kubernetes. */
	containerId: z.string(),
	nodeId: z.string(),
	claimId: z.string(),
	replicaIndex: z.number().int(),
	projectId: z.string().nullable(),
	image: z.string(),
	running: z.boolean(),
	/** The platform's own word: `running`, `restarting`, `exited`, … */
	platformState: z.string(),
	/** False means no claim asks for it, so the next pass removes it. */
	claimed: z.boolean(),
});

export const hostInventorySchema = z.object({
	/** Null when no orchestrator is reporting — which is not the same as nothing running. */
	at: z.string().nullable(),
	nodes: z.array(hostNodeSchema),
});

export const orchestrationStatusSchema = z.object({
	orchestrator: orchestratorInfoSchema,
	pool: z.object({
		/** Nodes that fit under the ceiling and the license. */
		placed: z.number().int(),
		/** Nodes every claim asks for, placed or not. */
		requested: z.number().int(),
		ceiling: z.number().int(),
	}),
	entitlement: z.object({
		maxReplicas: z.number().nullable(),
		types: z.array(z.enum(NODE_TYPES)),
		perProject: z.boolean(),
	}),
	/** False when a route-serving claim would only be refused — see #340. */
	canClaimRoutes: z.boolean(),
	claims: z.array(claimViewSchema),
	/**
	 * Claims serving every project, sent on the project surface only. Read-only
	 * there: a project owner sees what runs its work without being able to
	 * change an instance-wide workload.
	 */
	sharedClaims: z.array(claimViewSchema),
	alarms: z.array(groupAlarmSchema),
	/**
	 * The host's real inventory, from the orchestrator's last pass. Instance
	 * surface only, and the only place a container no claim asks for is
	 * visible — so nobody has to open the Docker CLI to see what is running.
	 */
	host: hostInventorySchema,
});

export const eventViewSchema = z.object({
	id: z.number().int(),
	nodeId: z.string().nullable(),
	claimId: z.string().nullable(),
	projectId: z.string().nullable(),
	/** `claim_created`, `created`, `recreated`, `removed`, `claim_released`, … */
	action: z.string(),
	reason: z.string().nullable(),
	detail: z.record(z.string(), z.unknown()).nullable(),
	createdAt: z.string(),
});

export const eventsResponseSchema = z.array(eventViewSchema);

export const eventsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

const replicas = z
	.number()
	.int()
	.min(1, "A claim needs at least one replica")
	.max(50, "More than 50 replicas of one claim is not a scale knob, it is a mistake");

export const createClaimBodySchema = z.object({
	type: z.enum(NODE_TYPES),
	/**
	 * Trigger groups this workload serves. Empty on a catch-all claim means
	 * every group no dedicated claim owns; `*` is not a value.
	 */
	groupIds: z.array(z.string()).default([]),
	replicas: replicas.default(1),
	/**
	 * How far the claim may autoscale above `replicas`, which becomes its floor.
	 * Omitted or null runs exactly `replicas`. Refused below `replicas`, and
	 * above it on a license that runs a fixed number of nodes.
	 */
	maxReplicas: replicas.nullable().optional(),
	/**
	 * Optional settings. `resources` is what one node may use: cpu in steps of
	 * 0.5 (0.5–16), memory in steps of 256 MB (256–65536). Omitted: 1 CPU, 1024 MB.
	 */
	metadata: claimMetadataSchema.optional(),
});

/**
 * On the instance surface a claim may also be written for every project. A
 * catch-all claim takes no groups — it serves every group no dedicated claim
 * owns — so the operator only says what it runs and how many copies of it.
 */
export const createInstanceClaimBodySchema = createClaimBodySchema.extend({
	projectId: z.string().nullable().default(null),
});

export const patchClaimBodySchema = z
	.object({
		type: z.enum(NODE_TYPES).optional(),
		groupIds: z.array(z.string()).optional(),
		replicas: replicas.optional(),
		/** Null clears the maximum, so the claim runs exactly `replicas` again. */
		maxReplicas: replicas.nullable().optional(),
		/** Per top-level key: one named here is replaced whole, one left out is kept. */
		metadata: claimMetadataSchema.optional(),
	})
	.refine((body) => Object.keys(body).length > 0, { message: "Nothing to change" });

export const claimParamSchema = z.object({ claimId: z.string() });

/**
 * What a write answers with. The claim id plus what it means, because every
 * write has a consequence worth stating: a container appears, a group list is
 * applied in place, or a node drains.
 */
export const claimAckSchema = z.object({ id: z.string(), message: z.string() });

export type NodeViewDto = z.infer<typeof nodeViewSchema>;
export type HostNodeDto = z.infer<typeof hostNodeSchema>;
export type ClaimViewDto = z.infer<typeof claimViewSchema>;
export type OrchestrationStatusDto = z.infer<typeof orchestrationStatusSchema>;
export type EventViewDto = z.infer<typeof eventViewSchema>;
export type CreateClaimBody = z.infer<typeof createClaimBodySchema>;
export type CreateInstanceClaimBody = z.infer<typeof createInstanceClaimBodySchema>;
export type PatchClaimBody = z.infer<typeof patchClaimBodySchema>;
