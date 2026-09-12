/**
 * The words both orchestration surfaces use.
 *
 * One file because a project owner and an operator must not be told different
 * stories about the same node, and because provisioning has consequences that
 * have to be stated *before* a control is used — which only works if the
 * statement lives next to the vocabulary rather than being retyped per button.
 */

export type ChipColor = "default" | "success" | "warning" | "danger";

/** The six states a node can be in, as a person would say them. */
export const STATE_LABEL: Record<string, { label: string; color: ChipColor }> = {
	pending: { label: "Pending", color: "warning" },
	starting: { label: "Starting", color: "default" },
	ready: { label: "Serving", color: "success" },
	unhealthy: { label: "Not responding", color: "danger" },
	stopping: { label: "Draining", color: "warning" },
	failed: { label: "Failed", color: "danger" },
};

/**
 * Why a node is in its state. Each one reads as something the reader could act
 * on, and **billing never appears** — a lapsed licence shows as no free slot,
 * not as an invoice.
 */
export const REASON_LABEL: Record<string, string> = {
	pool_unavailable: "The instance's node pool is full — the operator needs to grow it",
	no_license_slot: "Every licence slot is in use",
	not_licensed: "This licence does not allow a node of this shape",
	image_pull_failed: "The worker image could not be pulled",
	start_failed: "The container started and exited before it was ready",
	heartbeat_stale: "The container is up but the worker stopped answering",
	draining: "Finishing its work, then stopping",
};

/** What the orchestrator did, for the history. */
export const ACTION_LABEL: Record<string, string> = {
	claim_created: "Claim made",
	claim_updated: "Claim changed",
	claim_released: "Claim released",
	created: "Node created",
	recreated: "Node replaced",
	removed: "Node removed",
	create_failed: "Could not create the node",
	recreate_failed: "Could not replace the node",
	state_changed: "State changed",
};

export const TYPE_LABEL: Record<string, string> = {
	route: "APIs only",
	workflow: "Workflows only",
	both: "APIs and workflows",
};

/**
 * What each control does, said plainly before it is used. This is a
 * requirement of the feature rather than polish: provisioning either starts or
 * stops containers, and nobody should discover which one afterwards.
 */
export const CONSEQUENCE = {
	live: "Applied to the running nodes within seconds. No restart, no dropped requests.",
	scaleUp: "Starts another container. It serves traffic once it reports ready.",
	scaleDown: "Stops containers. Each one finishes what it is running first, then exits.",
	release:
		"Takes this workload offline. Its nodes stop accepting new work, finish what they are running, and stop.",
	pending:
		"More nodes than the pool allows are recorded and left pending — the operator has to grow the pool before they start.",
	singleNode:
		"This licence allows one node, so an update is stop-then-start: there is a short gap with nothing serving.",
} as const;

/**
 * Provider vocabulary. A node is a container on Docker and a pod on Kubernetes,
 * and the operator reading the page knows the difference — so the words come
 * from here rather than being hardcoded as "container".
 *
 * Adding a provider is adding an entry: the tables and panels render whatever
 * `meta` the orchestrator published, so nothing else has to know about it.
 */
export const PROVIDER: Record<string, { label: string; node: string; handle: string }> = {
	docker: { label: "Docker", node: "container", handle: "Container ID" },
	kubernetes: { label: "Kubernetes", node: "pod", handle: "Pod" },
};

export const providerWords = (provider: string | null) =>
	(provider && PROVIDER[provider]) || { label: "Unknown", node: "node", handle: "Handle" };

/** `meta` keys the orchestrator publishes, given readable names where we know them. */
export const META_LABEL: Record<string, string> = {
	endpoint: "Endpoint",
	workerImage: "Worker image",
	network: "Network",
	seedsDefaultClaim: "Seeds a default claim",
	namespace: "Namespace",
	cluster: "Cluster",
};

export const metaLabel = (key: string) =>
	META_LABEL[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** How long ago, in words. Used for heartbeats, where "5s ago" is the whole point. */
export function ago(iso: string | null): string {
	if (!iso) return "never";
	const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
}
