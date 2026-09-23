import { logger } from "@fluxify/common";
import { CATCH_ALL, type NodeType, type ObservedNode } from "@fluxify/common/orchestrator";
import { type ClaimResources, claimResources } from "./claimMetadata";
import { LABELS, MANAGED_BY, MANAGED_LABEL } from "./containerSpec";
import type { KubeApi, KubeObject } from "./drivers/kubernetesApi";
import type { Claim, DesiredNode } from "./projection";

/**
 * `NodeClaim` (#448): a claim as a Kubernetes resource, so `kubectl edit` and
 * GitOps can change it without the portal.
 *
 * The resource is a **door, not a second store**. The claim row stays the only
 * thing the infra is built from, and admin stays its only writer (§2):
 *
 * - The row is mirrored into the resource's spec every pass.
 * - An edit made on the resource (its `generation` moved past the one we last
 *   observed) is handed to admin, which runs the same checks as the portal.
 *   Accepted, the row changes and the next pass builds from it. Refused, the
 *   spec is put back and the reason stays on `status.conditions`.
 *
 * So whichever side wrote last wins, and both settle on the same values. A
 * GitOps tool that owns the resource will keep putting its own values back,
 * which is what it is for.
 *
 * Only `replicas`, `maxReplicas` and `resources` can be edited here. A
 * resource is never created or deleted by hand to create or release a claim:
 * one per claim is created by the orchestrator, named after the claim id.
 */

export const NODE_CLAIM_API = "fluxify.io/v1alpha1";

export interface NodeClaimSpec {
	/** `*` is the catch-all, serving every project. */
	project: string;
	type: NodeType;
	groups: string[];
	replicas: number;
	/** Absent runs exactly `replicas`. */
	maxReplicas?: number;
	resources: ClaimResources;
}

interface Condition {
	type: "Accepted";
	status: "True" | "False" | "Unknown";
	reason: "InSync" | "Accepted" | "Refused" | "Waiting";
	message: string;
	observedGeneration?: number;
	lastTransitionTime: string;
}

export interface NodeClaimStatus {
	observedGeneration?: number;
	/** Nodes the pool and license leave room for. */
	placed: number;
	/** Pods up right now, including any the autoscaler added. */
	ready: number;
	/** Nodes asked for that cannot be created yet; `reason` says why. */
	pending: number;
	reason?: string;
	conditions: Condition[];
}

/** What admin may apply from a resource: never the type, groups or project. */
export interface ClaimEdit {
	replicas?: number;
	maxReplicas?: number | null;
	metadata?: { resources: ClaimResources };
}

/** Admin's answer to an edit. Null when admin could not be asked; the edit is retried. */
export type ForwardEdit = (
	claimId: string,
	edit: ClaimEdit,
) => Promise<{ ok: true } | { ok: false; message: string } | null>;

export function nodeClaimSpec(claim: Claim): NodeClaimSpec {
	return {
		project: claim.projectId ?? CATCH_ALL,
		type: claim.type,
		groups: claim.groupIds,
		replicas: claim.replicas,
		...(claim.maxReplicas != null ? { maxReplicas: claim.maxReplicas } : {}),
		resources: claimResources(claim.metadata),
	};
}

const READ_ONLY = "is changed in the portal, not on the NodeClaim";

/**
 * What an edit to the resource asks of the claim: a patch of the editable
 * fields, or why it is refused without asking admin. An empty patch means the
 * spec already matches the row.
 */
export function readEdit(raw: unknown, claim: Claim): { edit: ClaimEdit } | { refusal: string } {
	const spec = (raw ?? {}) as Partial<NodeClaimSpec>;
	const row = nodeClaimSpec(claim);
	if (spec.project !== row.project) return { refusal: `project ${READ_ONLY}` };
	if (spec.type !== row.type) return { refusal: `type ${READ_ONLY}` };
	if (JSON.stringify(spec.groups ?? []) !== JSON.stringify(row.groups))
		return { refusal: `groups ${READ_ONLY}` };

	const edit: ClaimEdit = {};
	if (spec.replicas !== row.replicas) edit.replicas = spec.replicas;
	if ((spec.maxReplicas ?? null) !== (row.maxReplicas ?? null))
		edit.maxReplicas = spec.maxReplicas ?? null;
	const resources = { ...row.resources, ...spec.resources };
	if (JSON.stringify(resources) !== JSON.stringify(row.resources)) edit.metadata = { resources };
	return { edit };
}

/** What the portal would show for this claim, from the pass that just ran. */
export function claimCounts(
	claimId: string,
	nodes: readonly DesiredNode[],
	observed: readonly ObservedNode[],
): Pick<NodeClaimStatus, "placed" | "ready" | "pending" | "reason"> {
	const own = nodes.filter((node) => node.claimId === claimId);
	const waiting = own.find((node) => !node.placeable);
	return {
		placed: own.filter((node) => node.placeable).length,
		ready: observed.filter((node) => node.claimId === claimId && node.running).length,
		pending: own.filter((node) => !node.placeable).length,
		...(waiting?.reason ? { reason: waiting.reason } : {}),
	};
}

/** The new condition, keeping its transition time when nothing about it changed. */
function condition(
	previous: Condition | undefined,
	next: Omit<Condition, "type" | "lastTransitionTime">,
): Condition {
	const same =
		previous?.status === next.status &&
		previous.reason === next.reason &&
		previous.message === next.message;
	return {
		type: "Accepted",
		...next,
		lastTransitionTime: same ? previous.lastTransitionTime : new Date().toISOString(),
	};
}

const IN_SYNC = { status: "True", reason: "InSync", message: "Matches the claim" } as const;

/** Key order is the API server's to choose, so compared with keys sorted. */
function stable(value: unknown): string {
	return JSON.stringify(value, (_, inner) =>
		inner && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
			: inner,
	);
}

function withoutTime(status: NodeClaimStatus | undefined) {
	return stable({
		...status,
		conditions: status?.conditions?.map(({ lastTransitionTime: _, ...rest }) => rest),
	});
}

/** Whether a resource's spec already says what the claim row does. */
function matches(raw: unknown, claim: Claim): boolean {
	return stable(raw) === stable(nodeClaimSpec(claim));
}

/**
 * One pass over every claim and every resource. Failures are per resource and
 * logged: a NodeClaim that cannot be written must not stop the others, and
 * never the infra pass it runs after.
 */
export async function syncNodeClaims(
	api: KubeApi,
	claims: readonly Claim[],
	nodes: readonly DesiredNode[],
	observed: readonly ObservedNode[],
	forward: ForwardEdit,
): Promise<void> {
	const listed = await api.list("NodeClaim", "");
	// Not installed: the portal is the only door, and says what to install.
	if (api.missing().includes("NodeClaim")) return;
	const byName = new Map(listed.map((object) => [object.metadata.name, object]));

	for (const claim of claims) {
		const current = byName.get(claim.id);
		byName.delete(claim.id);
		try {
			await syncOne(api, claim, current, claimCounts(claim.id, nodes, observed), forward);
		} catch (error) {
			// A 409 is someone editing it between our read and write: next pass.
			logger.warn(`NodeClaim ${claim.id}: ${String(error)}`, "ORCHESTRATOR.kubernetes");
		}
	}

	for (const object of byName.values()) {
		try {
			// Ours, so its claim was released. Anyone else's names no claim.
			if (object.metadata.labels?.[MANAGED_LABEL] === MANAGED_BY) {
				await api.remove("NodeClaim", object.metadata.name);
				continue;
			}
			const previous = object.status as NodeClaimStatus | undefined;
			const status: NodeClaimStatus = {
				observedGeneration: object.metadata.generation,
				placed: 0,
				ready: 0,
				pending: 0,
				conditions: [
					condition(previous?.conditions?.[0], {
						status: "False",
						reason: "Refused",
						message:
							"No claim has this id. Claims are created in the portal; a NodeClaim can only change one.",
						observedGeneration: object.metadata.generation,
					}),
				],
			};
			if (withoutTime(previous) !== withoutTime(status))
				await api.applyStatus(statusObject(object.metadata.name, status));
		} catch (error) {
			logger.warn(`NodeClaim ${object.metadata.name}: ${String(error)}`, "ORCHESTRATOR.kubernetes");
		}
	}
}

function statusObject(name: string, status: NodeClaimStatus): KubeObject {
	return { apiVersion: NODE_CLAIM_API, kind: "NodeClaim", metadata: { name }, status };
}

async function syncOne(
	api: KubeApi,
	claim: Claim,
	current: KubeObject | undefined,
	counts: ReturnType<typeof claimCounts>,
	forward: ForwardEdit,
) {
	const spec = nodeClaimSpec(claim);
	const labels = { [MANAGED_LABEL]: MANAGED_BY, [LABELS.claim]: claim.id };
	const previous = current?.status as NodeClaimStatus | undefined;
	const last = previous?.conditions?.[0];
	/** Set when this pass observed an edit made on the resource. */
	let verdict: Omit<Condition, "type" | "lastTransitionTime"> | null = null;
	let mirror = true;

	if (current && current.metadata.generation !== (previous?.observedGeneration ?? -1)) {
		const read = readEdit(current.spec, claim);
		if ("refusal" in read) {
			verdict = { status: "False", reason: "Refused", message: read.refusal };
		} else if (Object.keys(read.edit).length === 0) {
			verdict = IN_SYNC;
		} else {
			const answer = await forward(claim.id, read.edit);
			if (!answer) {
				// Left unobserved, so it is asked again next pass — but no longer
				// showing the previous edit's verdict as if it were this one's.
				const waiting: NodeClaimStatus = {
					...(previous?.observedGeneration !== undefined
						? { observedGeneration: previous.observedGeneration }
						: {}),
					...counts,
					conditions: [
						condition(last, {
							status: "Unknown",
							reason: "Waiting",
							message: "Waiting for Fluxify to answer; the edit is retried every pass",
						}),
					],
				};
				if (withoutTime(previous) !== withoutTime(waiting))
					await api.applyStatus(statusObject(claim.id, waiting));
				return;
			}
			// Accepted, the row changes under admin: putting the old one back now would undo it.
			mirror = !answer.ok;
			verdict = answer.ok
				? { status: "True", reason: "Accepted", message: "Applied to the claim" }
				: { status: "False", reason: "Refused", message: answer.message };
		}
	}

	let stored: KubeObject | null | undefined = current;
	if (!current) {
		stored = await api.apply({
			apiVersion: NODE_CLAIM_API,
			kind: "NodeClaim",
			metadata: { name: claim.id, labels },
			spec,
		});
	} else if (
		mirror &&
		(!matches(current.spec, claim) || current.metadata.labels?.[MANAGED_LABEL] !== MANAGED_BY)
	) {
		stored = await api.patch("NodeClaim", claim.id, {
			// Fails with 409 if it was edited since the list, so that edit is not lost.
			metadata: { labels, resourceVersion: current.metadata.resourceVersion },
			// Null deletes: a maximum the portal cleared must not survive on the resource.
			spec: { ...spec, maxReplicas: spec.maxReplicas ?? null },
		});
		// A portal change: whatever was refused before no longer describes the spec.
		verdict ??= IN_SYNC;
	}
	if (!stored) return;

	const accepted = verdict ? condition(last, verdict) : (last ?? condition(undefined, IN_SYNC));
	const status: NodeClaimStatus = {
		observedGeneration: stored.metadata.generation,
		...counts,
		conditions: [{ ...accepted, observedGeneration: stored.metadata.generation }],
	};
	if (withoutTime(previous) !== withoutTime(status))
		await api.applyStatus(statusObject(claim.id, status));
}
