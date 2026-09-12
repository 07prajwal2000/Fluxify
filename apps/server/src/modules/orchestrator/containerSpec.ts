import { CATCH_ALL } from "@fluxify/common/orchestrator";
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
} as const;

/**
 * uuidv7, what `generateID()` produces for every id the orchestrator handles.
 * Checked rather than trusted: an id is about to become a container label, an
 * environment variable and part of a container name.
 */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This node's identity, derived rather than random: a container that is
 * recreated keeps its id, so the assignment record written for it (§4) is still
 * the right one and there is no mapping to store anywhere. 38 characters, which
 * fits `FLUXIFY_NODE_ID`'s 50.
 */
export function nodeIdFor(claimId: string, replicaIndex: number) {
	return `${claimId}.${replicaIndex}`;
}

/** Unique per replica — two containers cannot share a name on one host. */
export function containerNameFor(claimId: string, replicaIndex: number) {
	return `fluxify-worker-${claimId}-${replicaIndex}`;
}

export interface SpecOptions {
	/** From the orchestrator's environment, never from a row. */
	image: string;
	/** The docker network Traefik and NATS are on. */
	network: string;
	trafficPort: number;
	healthPort: number;
	/** Per-node budgets from the pool config. Unset leaves it to the platform. */
	cpuPerNode?: number;
	memoryPerNodeMb?: number;
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
const SERVES_HTTP = ["route", "both"];

/**
 * The Traefik labels that used to live on the compose `worker` service. Only a
 * catch-all node gets them: a project-pinned route node is reached by a `Host`
 * rule built from the project's subdomain, and subdomains do not exist yet
 * (#340). Until then a route claim cannot even be written — `validateClaim`
 * refuses one without a subdomain — so there is no case here to serve.
 *
 * The router and service names are shared by every catch-all node, which is
 * what makes Traefik load-balance across them instead of routing to one. That
 * is the same grouping compose got from `replicas: 2`.
 */
function edgeLabels(node: DesiredNode, options: SpecOptions): Record<string, string> {
	if (!SERVES_HTTP.includes(node.type) || node.projectId !== null) return {};
	const ready = "/_/admin/api/healthchecks/ready";
	return {
		"traefik.enable": "true",
		"traefik.http.routers.fluxify-worker.rule": "PathPrefix(`/`)",
		"traefik.http.routers.fluxify-worker.priority": "1",
		"traefik.http.routers.fluxify-worker.entrypoints": "web",
		"traefik.http.services.fluxify-worker.loadbalancer.server.port": String(options.trafficPort),
		// Health is on its own port, served by the supervisor. Checking the
		// traffic port would hit an isolated execution process, which does not
		// describe whether the node is serving.
		"traefik.http.services.fluxify-worker.loadbalancer.healthcheck.path": ready,
		"traefik.http.services.fluxify-worker.loadbalancer.healthcheck.port": String(options.healthPort),
		"traefik.http.services.fluxify-worker.loadbalancer.healthcheck.interval": "10s",
	};
}

export function buildContainerSpec(node: DesiredNode, options: SpecOptions): ContainerSpec {
	if (!ID_PATTERN.test(node.claimId)) {
		throw new Error(`refusing to create a container for a malformed claim id: ${node.claimId}`);
	}
	if (node.projectId !== null && !ID_PATTERN.test(node.projectId)) {
		throw new Error(`refusing to create a container for a malformed project id: ${node.projectId}`);
	}
	if (!Number.isInteger(node.replicaIndex) || node.replicaIndex < 0) {
		throw new Error(`refusing to create a container for replica index ${node.replicaIndex}`);
	}
	const badGroup = node.groupIds.find((id) => !ID_PATTERN.test(id));
	if (badGroup) {
		throw new Error(`refusing to create a container for a malformed group id: ${badGroup}`);
	}

	const nodeId = nodeIdFor(node.claimId, node.replicaIndex);
	const env: Record<string, string> = {
		...options.passthroughEnv,
		WORKER_PROJECT_ID: node.projectId ?? CATCH_ALL,
		WORKER_MODE: node.type,
		WORKER_GROUP_ID: node.groupIds.join(","),
		FLUXIFY_NODE_ID: nodeId,
		WORKER_PORT: String(options.trafficPort),
		WORKER_HEALTH_PORT: String(options.healthPort),
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
				...(options.memoryPerNodeMb ? { Memory: options.memoryPerNodeMb * 1024 * 1024 } : {}),
				...(options.cpuPerNode ? { NanoCpus: Math.round(options.cpuPerNode * 1e9) } : {}),
			},
		},
	};
}
