import type { ObservedNode } from "@fluxify/common/orchestrator";
import { LABELS } from "./containerSpec";
import type { KubeObject } from "./drivers/kubernetesApi";
import { contentHash } from "./kubernetesSpec";

/**
 * What to send to the API server this pass, and what to read back off it.
 *
 * The Kubernetes counterpart of `plan.ts`, and pure for the same reason: the
 * driver carries the plan out without choosing any of it. Docker compares
 * container by container; here the unit is a claim's objects, so the whole
 * comparison is "absent, changed, edited by someone else, or unwanted".
 */

export const objectKey = (object: Pick<KubeObject, "kind" | "metadata">) =>
	`${object.kind}/${object.metadata.name}`;

/** What this orchestrator last sent for an object, and the generation that came back. */
export interface Applied {
	hash: string;
	generation?: number;
}

export const objectHash = (object: KubeObject) => contentHash({ object: JSON.stringify(object) });

/** Deleted in this order: the autoscaler and the route go before what they point at. */
const REMOVAL_ORDER = ["ScaledObject", "IngressRoute", "Service", "Deployment"];

export interface KubePlan {
	apply: KubeObject[];
	remove: KubeObject[];
}

/**
 * An object is sent when it is missing, when what it should look like changed,
 * or when its generation moved since this orchestrator's own apply — the API
 * server bumps it on any spec change, so a `kubectl edit` is noticed and put
 * back. An autoscaler resizing the Deployment bumps it too; re-applying then
 * changes nothing, which is how the driver tells the two apart.
 *
 * An object is removed when it carries a claim label and nothing wants it,
 * unless its claim is in `keep`: a claim the license stopped allowing keeps
 * serving (§12), exactly as its containers would on Docker.
 */
export function planKubernetes({
	wanted,
	observed,
	applied,
	keep,
}: {
	wanted: readonly KubeObject[];
	observed: readonly KubeObject[];
	applied: ReadonlyMap<string, Applied>;
	keep: ReadonlySet<string>;
}): KubePlan {
	const found = new Map(observed.map((object) => [objectKey(object), object]));
	const wantedKeys = new Set(wanted.map(objectKey));

	const apply = wanted.filter((object) => {
		const current = found.get(objectKey(object));
		const last = applied.get(objectKey(object));
		return (
			!current ||
			last?.hash !== objectHash(object) ||
			last.generation !== current.metadata.generation
		);
	});

	const remove = observed
		.filter((object) => {
			const claimId = object.metadata.labels?.[LABELS.claim];
			// No claim label: shared (the worker env Secret) or not ours to judge.
			if (!claimId || keep.has(claimId)) return false;
			return !wantedKeys.has(objectKey(object)) && !object.metadata.deletionTimestamp;
		})
		.sort((a, b) => REMOVAL_ORDER.indexOf(a.kind) - REMOVAL_ORDER.indexOf(b.kind));

	return { apply, remove };
}

interface PodStatus {
	phase?: string;
	conditions?: { type: string; status: string; reason?: string }[];
	containerStatuses?: {
		state?: {
			running?: unknown;
			waiting?: { reason?: string };
			terminated?: { reason?: string };
		};
	}[];
}

/**
 * The platform's own word for a pod, the way Docker's `State` is for a
 * container: `running`, a waiting reason (`ImagePullBackOff`,
 * `CrashLoopBackOff`, …), `Unschedulable` for a pod no machine has room for,
 * or `terminating` while it drains.
 */
export function podState(pod: KubeObject): string {
	if (pod.metadata.deletionTimestamp) return "terminating";
	const status = (pod.status ?? {}) as PodStatus;
	const state = status.containerStatuses?.[0]?.state;
	if (state?.running) return "running";
	const reason = state?.waiting?.reason ?? state?.terminated?.reason;
	if (reason) return reason;
	const scheduled = status.conditions?.find((condition) => condition.type === "PodScheduled");
	if (scheduled?.status === "False" && scheduled.reason) return scheduled.reason;
	return status.phase ?? "Pending";
}

/**
 * Pods as nodes. The pod name is the node id — it is what the worker heartbeats
 * under — and since a Deployment's pods have no replica number, they are
 * numbered by name within their claim. That number is for display only.
 */
export function podsToNodes(pods: readonly KubeObject[]): ObservedNode[] {
	const byClaim = new Map<string, KubeObject[]>();
	for (const pod of pods) {
		const claimId = pod.metadata.labels?.[LABELS.claim];
		if (!claimId) continue;
		byClaim.set(claimId, [...(byClaim.get(claimId) ?? []), pod]);
	}

	const nodes: ObservedNode[] = [];
	for (const [claimId, claimPods] of byClaim) {
		claimPods.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
		claimPods.forEach((pod, replicaIndex) => {
			const state = podState(pod);
			const spec = pod.spec as { containers?: { image?: string }[] } | undefined;
			nodes.push({
				containerId: pod.metadata.name,
				nodeId: pod.metadata.name,
				claimId,
				replicaIndex,
				projectId: pod.metadata.labels?.[LABELS.project] ?? null,
				host: pod.metadata.annotations?.[LABELS.host] ?? null,
				image: spec?.containers?.[0]?.image ?? "",
				running: state === "running",
				platformState: state,
			});
		});
	}
	return nodes;
}
