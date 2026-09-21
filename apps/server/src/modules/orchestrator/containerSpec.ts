import { CATCH_ALL } from "@fluxify/common/orchestrator";
import type { ClaimResources } from "./claimMetadata";
import type { DesiredNode } from "./projection";

/**
 * One desired node turned into the exact body Docker is asked to create.
 *
 * This file is the trust boundary in practice (§13). The socket is
 * root-equivalent on the host and admin can cause a container to be created, so
 * **no string a user can write may reach Docker**: the image comes from the
 * orchestrator's own environment, ids are checked against the shape the
 * database generates before they become labels or env, and the vocabulary is
 * this one function rather than raw arguments.
 *
 * Pure on purpose — the arithmetic and the validation are tested without a
 * daemon, and `docker.ts` only knows how to post what this produces.
 */

/** Marks a container as this orchestrator's to manage. Nothing else is touched. */
export const MANAGED_LABEL = "fluxify.managed-by";
export const MANAGED_BY = "orchestrator";

/** Everything else written on a container, so the reconciler can read a node back off it. */
export const LABELS = {
	claim: "fluxify.claim-id",
	replica: "fluxify.replica-index",
	project: "fluxify.project-id",
	node: "fluxify.node-id",
	host: "fluxify.host",
	resources: "fluxify.resources",
} as const;

/**
 * uuidv7, what `generateID()` produces for every id the orchestrator handles.
 * Checked rather than trusted: an id is about to become a container label, an
 * environment variable and part of a container name.
 */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A hostname, rechecked here although settings validate it: it is written into
 * a Traefik rule, where a backtick would end the string and start a new rule.
 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * This node's identity, derived rather than random: a container that is
 * recreated keeps its id, so the assignment record written for it (§4) is still
 * the right one and there is no mapping to store anywhere. 38 characters, which
 * fits `FLUXIFY_NODE_ID`'s 100.
 */
export function nodeIdFor(claimId: string, replicaIndex: number) {
	return `${claimId}.${replicaIndex}`;
}

/** Unique per replica — two containers cannot share a name on one host. */
export function containerNameFor(claimId: string, replicaIndex: number) {
	return `fluxify-worker-${claimId}-${replicaIndex}`;
}

/**
 * A node's size as one label value, `<cpu>/<memoryMb>`. Docker cannot report
 * a container's limits in a listing, so the label is how a resize is noticed.
 */
export function resourcesLabel(resources: ClaimResources) {
	return `${resources.cpu}/${resources.memoryMb}`;
}

export interface SpecOptions {
	/** From the orchestrator's environment, never from a row. */
	image: string;
	/** The docker network Traefik and NATS are on. */
	network: string;
	trafficPort: number;
	healthPort: number;
	/**
	 * Settings copied from the orchestrator's own environment (broker address,
	 * encryption key, log shipping). Resolved by the caller so this stays pure.
	 */
	passthroughEnv: Record<string, string>;
}

export interface ContainerSpec {
	name: string;
	body: Record<string, unknown>;
}

/** Nodes that serve HTTP and therefore need the edge to know about them. */
export const SERVES_HTTP: readonly string[] = ["route", "both"];

/**
 * Where the worker's supervisor answers readiness. It fails on purpose while
 * the worker drains (#336), which is what takes a node off the edge before it stops.
 */
export const READY_PATH = "/_/admin/api/healthchecks/ready";

/** The part of a node that reaches a platform as names, labels, rules and env. */
export type Workload = Pick<DesiredNode, "claimId" | "projectId" | "type" | "groupIds" | "host">;

export const isWellFormedId = (id: string) => ID_PATTERN.test(id);

/**
 * The trust boundary, shared by every driver: each id is the shape the
 * database generates and the host is a hostname, or nothing is sent. A host
 * lands in a Traefik rule on Docker and on Kubernetes alike.
 */
export function assertWellFormed(node: Workload) {
	if (!ID_PATTERN.test(node.claimId)) {
		throw new Error(`refusing a malformed claim id: ${node.claimId}`);
	}
	if (node.projectId !== null && !ID_PATTERN.test(node.projectId)) {
		throw new Error(`refusing a malformed project id: ${node.projectId}`);
	}
	if (node.host && !HOST_PATTERN.test(node.host)) {
		throw new Error(`refusing a malformed host: ${node.host}`);
	}
	const badGroup = node.groupIds.find((id) => !ID_PATTERN.test(id));
	if (badGroup) throw new Error(`refusing a malformed group id: ${badGroup}`);
}

/**
 * What a worker is told about itself, on every platform. The node id and the
 * settings copied from the orchestrator are added by each driver, because each
 * platform delivers those differently.
 */
export function workerEnv(
	node: Workload,
	ports: Pick<SpecOptions, "trafficPort" | "healthPort">,
): Record<string, string> {
	return {
		WORKER_PROJECT_ID: node.projectId ?? CATCH_ALL,
		WORKER_MODE: node.type,
		WORKER_GROUP_ID: node.groupIds.join(","),
		// Which assignment record this node reads (#426). The claim rather than
		// the node, because every replica of a claim runs the same thing — and a
		// Deployment's pods have no name the orchestrator could have written one
		// under in advance.
		FLUXIFY_CLAIM_ID: node.claimId,
		WORKER_PORT: String(ports.trafficPort),
		WORKER_HEALTH_PORT: String(ports.healthPort),
	};
}

/**
 * The Traefik labels for a node that serves APIs.
 *
 * A catch-all node takes everything, `PathPrefix(/)` at the lowest priority —
 * the shape the compose `worker` service had. It serves every project, so a
 * request for a subdomain it does not know is answered by the worker's own 404.
 *
 * A project-pinned node is reached on its project's host (#340), at a priority
 * above the catch-all and below the admin's `/_/admin` rule, which must keep
 * working on every host. Without a host it gets nothing: `validateClaim`
 * refuses such a claim, so the only way here is a subdomain removed under it.
 *
 * Router and service names are shared by every node of one scope — all
 * catch-alls, or one project's — which is what makes Traefik load-balance
 * across them instead of routing to one.
 */
function edgeLabels(node: DesiredNode, options: SpecOptions): Record<string, string> {
	if (!SERVES_HTTP.includes(node.type)) return {};
	if (node.projectId !== null && !node.host) return {};
	const name = node.projectId === null ? "fluxify-worker" : `fluxify-project-${node.projectId}`;
	const rule = node.projectId === null ? "PathPrefix(`/`)" : `Host(\`${node.host}\`)`;
	return {
		"traefik.enable": "true",
		[`traefik.http.routers.${name}.rule`]: rule,
		[`traefik.http.routers.${name}.priority`]: node.projectId === null ? "1" : "50",
		[`traefik.http.routers.${name}.entrypoints`]: "web",
		[`traefik.http.routers.${name}.service`]: name,
		[`traefik.http.services.${name}.loadbalancer.server.port`]: String(options.trafficPort),
		// Health is on its own port, served by the supervisor. Checking the
		// traffic port would hit an isolated execution process, which does not
		// describe whether the node is serving.
		[`traefik.http.services.${name}.loadbalancer.healthcheck.path`]: READY_PATH,
		[`traefik.http.services.${name}.loadbalancer.healthcheck.port`]: String(options.healthPort),
		[`traefik.http.services.${name}.loadbalancer.healthcheck.interval`]: "10s",
	};
}

export function buildContainerSpec(node: DesiredNode, options: SpecOptions): ContainerSpec {
	assertWellFormed(node);
	if (!Number.isInteger(node.replicaIndex) || node.replicaIndex < 0) {
		throw new Error(`refusing to create a container for replica index ${node.replicaIndex}`);
	}

	const nodeId = nodeIdFor(node.claimId, node.replicaIndex);
	const env: Record<string, string> = {
		...options.passthroughEnv,
		...workerEnv(node, options),
		FLUXIFY_NODE_ID: nodeId,
	};

	return {
		name: containerNameFor(node.claimId, node.replicaIndex),
		body: {
			Image: options.image,
			Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
			Labels: {
				[MANAGED_LABEL]: MANAGED_BY,
				[LABELS.claim]: node.claimId,
				[LABELS.replica]: String(node.replicaIndex),
				[LABELS.project]: node.projectId ?? CATCH_ALL,
				[LABELS.node]: nodeId,
				[LABELS.resources]: resourcesLabel(node.resources),
				...(node.host ? { [LABELS.host]: node.host } : {}),
				...edgeLabels(node, options),
			},
			ExposedPorts: {
				[`${options.trafficPort}/tcp`]: {},
				[`${options.healthPort}/tcp`]: {},
			},
			HostConfig: {
				NetworkMode: options.network,
				// Crash recovery belongs to the platform (§6). A second controller
				// restarting containers on top of Docker's own restarts would
				// thrash; the reconciler only acts when a container is gone.
				RestartPolicy: { Name: "unless-stopped" },
				PidsLimit: 512,
				Memory: node.resources.memoryMb * 1024 * 1024,
				NanoCpus: Math.round(node.resources.cpu * 1e9),
			},
		},
	};
}
