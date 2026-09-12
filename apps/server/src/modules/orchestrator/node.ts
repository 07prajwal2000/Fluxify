import { randomUUID } from "node:crypto";
import { logger } from "@fluxify/common";
import { openKvBucket } from "@fluxify/common/nats";
import {
	NODE_ASSIGNMENT_BUCKET,
	NODE_HEARTBEAT_INTERVAL_MS,
	NODE_LIVENESS_BUCKET,
	NODE_LIVENESS_TTL_MS,
	orchestratorKeys,
	type NodeAssignment,
	type NodeEntitlement,
	type NodeHeartbeat,
	type NodeReason,
	type NodeType,
} from "@fluxify/common/orchestrator";
import { initializeNats } from "../../db/nats";

/**
 * The worker's side of the control plane: it takes a license slot, keeps it
 * alive, and reads what it should be running.
 *
 * The slot key and the heartbeat key are the same key, which is what makes the
 * license self-healing. A worker killed with SIGKILL releases nothing, so if
 * the slot were a separate permanent record its replacement would find no room
 * and exit, and the license would silently throttle itself to zero. Here the
 * key simply stops being renewed and expires.
 *
 * Nothing in this file calls `process.exit` — it reports a refusal and lets the
 * deployment entry point decide, which is also what makes it testable.
 */

/** Short and random, because the id only has to be unique among live nodes. */
export function generateNodeId() {
	return randomUUID().replace(/-/g, "").slice(0, 5);
}

export interface SlotRefusal {
	reason: Extract<NodeReason, "not_licensed" | "no_license_slot">;
	message: string;
}

/**
 * Whether the license has room for one more node of this type. Pure, so the
 * arithmetic that decides whether a container lives or dies is testable without
 * a broker.
 *
 * `liveNodes` counts every other node holding a slot, of any type: a replica is
 * a container and each one costs a slot, whatever it runs (§7).
 */
export function refuseSlot(context: {
	type: NodeType;
	entitlement: NodeEntitlement;
	liveNodes: number;
}): SlotRefusal | null {
	const { type, entitlement, liveNodes } = context;
	if (!entitlement.types.includes(type)) {
		return {
			reason: "not_licensed",
			message: `this license does not allow a '${type}' node (allowed: ${entitlement.types.join(", ")})`,
		};
	}
	const cap = entitlement.maxReplicas;
	if (cap !== null && liveNodes >= cap) {
		return {
			reason: "no_license_slot",
			message: `this license allows ${cap} worker node${cap === 1 ? "" : "s"} and ${liveNodes} ${liveNodes === 1 ? "is" : "are"} already running`,
		};
	}
	return null;
}

/**
 * Whether this node lost a simultaneous claim.
 *
 * Writing the key is atomic, but counting the others then writing is not: two
 * workers starting together can both see room and both take it. Rather than
 * indexing slot keys — which would mean the slot and the heartbeat are no
 * longer one key — the loser is worked out after the fact, from the same
 * records the count already read: the oldest `cap` nodes keep their slots.
 *
 * `at` is written by the node itself, so two clocks slightly apart can order
 * two nodes the "wrong" way. That only decides *which* of the two surplus
 * workers exits, and one of them always does.
 */
export function losesClaimRace(
	mine: NodeHeartbeat,
	all: readonly NodeHeartbeat[],
	cap: number | null,
): boolean {
	if (cap === null) return false;
	const order = [...all].sort((a, b) => a.at.localeCompare(b.at) || a.nodeId.localeCompare(b.nodeId));
	return order.findIndex((node) => node.nodeId === mine.nodeId) >= cap;
}

export interface NodeSlotOptions {
	nodeId: string;
	projectId: string;
	type: NodeType;
	groupIds: string[];
	claimId?: string;
	/**
	 * The id came from the environment, so the orchestrator may have reserved
	 * this node's key already and an existing value is ours to take over. A
	 * generated id has no such claim: a value under it belongs to someone else.
	 */
	reserved: boolean;
	/** Read fresh on every renewal, so a license change takes effect in place. */
	entitlement: () => NodeEntitlement;
	/**
	 * The slot is gone and cannot be retaken — the node is over the license now.
	 * Renewal stops before this is called.
	 */
	onLost: (refusal: SlotRefusal) => void;
}

export interface NodeSlot {
	/** The id actually taken, which differs from a generated one that collided. */
	nodeId: string;
	/**
	 * Updates what the record says about this node — `ready` is how admin tells
	 * starting from serving, and the groups change when it is reassigned. Picked
	 * up by the next renewal rather than written immediately: nothing reads this
	 * faster than the heartbeat anyway.
	 */
	report(patch: { ready?: boolean; groupIds?: string[] }): void;
	/** Frees the slot now instead of waiting out the TTL. */
	release(): Promise<void>;
}

/**
 * Takes a slot, or explains why it cannot. On success the record is renewed in
 * the background until `release()`.
 *
 * The orchestrator writes this key itself when it provisions a node, so a node
 * it wants never loses the claim to a hand-started worker — the reserved key is
 * simply renewed here rather than created.
 */
export async function claimNodeSlot(
	options: NodeSlotOptions,
): Promise<{ ok: true; slot: NodeSlot } | { ok: false; refusal: SlotRefusal }> {
	const nc = await initializeNats();
	const bucket = await openKvBucket<NodeHeartbeat>(nc, NODE_LIVENESS_BUCKET, {
		ttlMs: NODE_LIVENESS_TTL_MS,
	});

	async function liveNodes(): Promise<NodeHeartbeat[]> {
		const keys = await bucket.keys(orchestratorKeys.allNodes);
		const records = await Promise.all(keys.map((k) => bucket.get(k)));
		return records.filter((node): node is NodeHeartbeat => node !== null);
	}

	let nodeId = options.nodeId;
	const others = (await liveNodes()).filter((node) => node.nodeId !== nodeId);
	const entitlement = options.entitlement();
	const refusal = refuseSlot({ type: options.type, entitlement, liveNodes: others.length });
	if (refusal) return { ok: false, refusal };

	function heartbeat(): NodeHeartbeat {
		return {
			nodeId,
			...(options.claimId ? { claimId: options.claimId } : {}),
			projectId: options.projectId,
			type: options.type,
			groupIds: options.groupIds,
			ready: false,
			at: new Date().toISOString(),
		};
	}

	let record = heartbeat();
	let key = orchestratorKeys.node(nodeId);
	// A reserved key is this node's to take. A generated id that lands on an
	// existing key has simply collided with a live node, and five random
	// characters are cheap to draw again — stealing its key would leave two
	// nodes renewing the same one until one of them gave up and exited.
	let revision = await bucket.create(key, record);
	for (let attempt = 0; revision === null && attempt < 3; attempt++) {
		if (options.reserved) {
			revision = await bucket.put(key, record);
			break;
		}
		nodeId = generateNodeId();
		record = heartbeat();
		key = orchestratorKeys.node(nodeId);
		revision = await bucket.create(key, record);
	}
	if (revision === null) {
		return {
			ok: false,
			refusal: { reason: "no_license_slot", message: "could not write a node id nobody else holds" },
		};
	}

	if (losesClaimRace(record, [...others, record], entitlement.maxReplicas)) {
		await bucket.delete(key);
		return {
			ok: false,
			refusal: {
				reason: "no_license_slot",
				message: `lost a simultaneous claim for the last of ${entitlement.maxReplicas} licensed node slots`,
			},
		};
	}

	// Narrowed out of the claim loop: renewal is a closure, so the null check
	// above does not follow the variable into it.
	let held: number = revision;
	let stopped = false;
	const timer = setInterval(() => void renew(), NODE_HEARTBEAT_INTERVAL_MS);

	/**
	 * Renewal is revision-checked rather than a blind write: a node paused long
	 * enough for its key to expire must not overwrite whoever took the slot in
	 * the meantime. A failed update means the key is no longer the one we wrote,
	 * so the slot is retaken from scratch — which succeeds when it merely
	 * expired unclaimed, and fails when someone else holds it.
	 */
	async function renew() {
		if (stopped) return;
		record = { ...record, at: new Date().toISOString() };
		try {
			const next = await bucket.update(key, record, held);
			if (next !== null) {
				held = next;
				return;
			}
			const retaken = await bucket.create(key, record);
			if (retaken !== null) {
				held = retaken;
				logger.warn(
					`node ${nodeId} lease expired and was retaken — the control plane briefly saw this node as dead`,
					"WORKER.node",
				);
				return;
			}
			stopped = true;
			clearInterval(timer);
			options.onLost({
				reason: "no_license_slot",
				message: "this node's license slot expired and another node took it",
			});
		} catch (error) {
			// A broker blip is not a lost slot; the TTL is three renewals wide on
			// purpose, so there is room to fail and try again.
			logger.warn(`node ${nodeId} heartbeat failed: ${String(error)}`, "WORKER.node");
		}
	}

	return {
		ok: true,
		slot: {
			nodeId,
			report(patch) {
				record = { ...record, ...patch };
			},
			async release() {
				if (stopped) return;
				stopped = true;
				clearInterval(timer);
				await bucket.delete(key).catch((error) =>
					// Not fatal: the TTL frees the slot anyway, just slower.
					logger.warn(
						`could not release node ${nodeId}'s slot: ${String(error)}`,
						"WORKER.node",
					),
				);
			},
		},
	};
}

/**
 * What this node should be running, pushed as it changes.
 *
 * `onChange` gets null when no record exists, which is the normal state for a
 * hand-started worker and for Kit — neither has an orchestrator writing one, so
 * the caller falls back to its environment.
 */
export async function watchNodeAssignment(
	nodeId: string,
	onChange: (assignment: NodeAssignment | null) => void | Promise<void>,
) {
	const nc = await initializeNats();
	const bucket = await openKvBucket<NodeAssignment>(nc, NODE_ASSIGNMENT_BUCKET);
	const key = orchestratorKeys.assignment(nodeId);
	const watcher = await bucket.watch(key, (_key, value) => onChange(value));
	await watcher.initialized;
	return watcher;
}

/**
 * What this node runs. The environment is the starting point and the
 * orchestrator's assignment record overrides it — absent means nobody is
 * orchestrating this worker, which is the normal case for a hand-started
 * container and for Kit.
 *
 * The project is deliberately not in here: it is baked into the container's env
 * and Traefik labels, and labels cannot be changed on a running container, so a
 * project change recreates the node instead (§4).
 */
export interface AttachedNode {
	type: NodeType;
	groupIds: string[];
	excludedGroups: Set<string>;
	slot: NodeSlot;
	/** Called once startup finishes, so admin can tell starting from serving. */
	serving(): void;
	stop(): Promise<void>;
}

export interface AttachOptions {
	/** Set by the orchestrator when it provisioned this node; absent otherwise. */
	envNodeId?: string;
	projectId: string;
	envType: NodeType;
	envGroupIds: string[];
	entitlement: () => NodeEntitlement;
	/** This node's groups changed — re-decide what runs here. */
	onGroupsChanged: () => void;
	/**
	 * This node must not keep running as it is: it was retyped (exit 0, the
	 * restart re-reads the assignment) or it lost its slot (exit 1).
	 */
	onStop: (reason: string, exitCode: number) => void;
}

/**
 * Joins the control plane: work out what to run, take a license slot, and keep
 * both up to date. Everything a worker needs from the orchestrator, so a
 * deployment entry point wires one call rather than five.
 */
export async function attachNode(
	options: AttachOptions,
): Promise<{ ok: true; node: AttachedNode } | { ok: false; refusal: SlotRefusal }> {
	const { envNodeId, envType, envGroupIds } = options;
	/**
	 * Also the boot gate: until the slot is taken, a record is simply this
	 * node's starting point. After that a type change has to restart the
	 * process, because the consumers bound to the old type are already running.
	 */
	let slot: NodeSlot | null = null;

	const state = {
		type: envType,
		groupIds: envGroupIds,
		excludedGroups: new Set<string>(),
	};

	function apply(assignment: NodeAssignment | null) {
		if (!assignment) return;
		state.type = assignment.type;
		state.groupIds = assignment.groupIds;
		state.excludedGroups = new Set(assignment.excludedGroups);
	}

	/**
	 * Groups are applied in place. A type change is not: it decides which
	 * artifact kinds are watched and which job subjects are consumed, both bound
	 * once at startup, so rebuilding those live would be a second startup path
	 * to keep correct. The node restarts instead and re-reads this same record
	 * on the way up (§4).
	 */
	function onChange(assignment: NodeAssignment | null) {
		if (!assignment) return;
		if (!slot) return apply(assignment);
		if (assignment.type !== state.type) {
			return options.onStop(`reassigned from ${state.type} to ${assignment.type}`, 0);
		}
		apply(assignment);
		slot.report({ groupIds: state.groupIds });
		options.onGroupsChanged();
	}

	// Read before the slot is taken, because the type decides what this node
	// claims. A node with no id in its environment was not provisioned, so
	// nothing is written for it yet and its watch opens once the id exists.
	let watcher = envNodeId ? await watchNodeAssignment(envNodeId, onChange) : null;

	const claim = await claimNodeSlot({
		nodeId: envNodeId ?? generateNodeId(),
		reserved: Boolean(envNodeId),
		projectId: options.projectId,
		type: state.type,
		groupIds: state.groupIds,
		entitlement: options.entitlement,
		onLost: (refusal) => options.onStop(`license slot lost — ${refusal.message}`, 1),
	});
	if (!claim.ok) {
		await watcher?.stop();
		return claim;
	}
	slot = claim.slot;
	watcher ??= await watchNodeAssignment(slot.nodeId, onChange);

	return {
		ok: true,
		node: {
			get type() {
				return state.type;
			},
			get groupIds() {
				return state.groupIds;
			},
			get excludedGroups() {
				return state.excludedGroups;
			},
			slot: claim.slot,
			serving() {
				claim.slot.report({ ready: true });
			},
			async stop() {
				await claim.slot.release();
				await watcher?.stop();
			},
		},
	};
}
