import { logger } from "@fluxify/common";
import { CATCH_ALL } from "@fluxify/common/orchestrator";
import { getEnv } from "../../lib/env";
import { LABELS, MANAGED_BY, MANAGED_LABEL, type ContainerSpec } from "./containerSpec";
import type { ObservedNode } from "./plan";

/**
 * Every Docker API call, in one file.
 *
 * No provider interface: there is one platform today and a second one is what
 * earns the abstraction (#338). Bun speaks the daemon's HTTP API over a socket
 * directly, so this needs no client library — the whole driver is a `fetch`
 * with a few paths.
 *
 * It performs actions and never chooses one. What should happen is decided in
 * `plan.ts`, and the body of a container is built in `containerSpec.ts`, so the
 * process holding a root-equivalent socket has exactly one narrow vocabulary.
 */

/** Where the daemon listens, and how to reach it. */
export function dockerEndpoint(host = getEnv("DOCKER_HOST")): { base: string; unix?: string } {
	if (!host) {
		// The container mounts the socket; a developer sets DOCKER_HOST.
		return { base: "http://localhost", unix: "/var/run/docker.sock" };
	}
	if (host.startsWith("tcp://")) return { base: `http://${host.slice("tcp://".length)}` };
	if (host.startsWith("http://") || host.startsWith("https://")) return { base: host };
	if (host.startsWith("unix://")) {
		return { base: "http://localhost", unix: host.slice("unix://".length) };
	}
	// Bun's fetch can open a unix socket but not a Windows named pipe, so there
	// is nothing to fall back to — say which value works instead.
	throw new Error(
		`unsupported DOCKER_HOST '${host}'. Use tcp://host:port or unix:///var/run/docker.sock — a named pipe cannot be opened (on Docker Desktop, expose the daemon on tcp://localhost:2375)`,
	);
}

async function dockerFetch(path: string, init?: RequestInit): Promise<Response> {
	const { base, unix } = dockerEndpoint();
	const response = await fetch(`${base}${path}`, { ...init, ...(unix ? { unix } : {}) });
	if (!response.ok) {
		throw new Error(`docker ${path} failed (${response.status}): ${await response.text()}`);
	}
	return response;
}

const json = { "content-type": "application/json" } as const;

/** Whether the daemon is reachable at all, for the readiness probe. */
export async function dockerReachable(): Promise<boolean> {
	try {
		await dockerFetch("/_ping");
		return true;
	} catch {
		return false;
	}
}

interface DockerContainer {
	Id: string;
	Image: string;
	State: string;
	Labels: Record<string, string>;
}

/**
 * The containers this orchestrator manages — and only those. An unlabelled
 * container is not merely left alone, it is never seen: the filter is applied
 * by the daemon, so a hand-started worker or an unrelated container on a
 * developer's machine cannot become an orphan to delete.
 */
export async function listManagedNodes(): Promise<ObservedNode[]> {
	const filters = encodeURIComponent(
		JSON.stringify({ label: [`${MANAGED_LABEL}=${MANAGED_BY}`] }),
	);
	const response = await dockerFetch(`/containers/json?all=true&filters=${filters}`);
	const containers = (await response.json()) as DockerContainer[];

	const nodes: ObservedNode[] = [];
	for (const container of containers) {
		const labels = container.Labels ?? {};
		const nodeId = labels[LABELS.node];
		const claimId = labels[LABELS.claim];
		const replicaIndex = Number(labels[LABELS.replica]);
		if (!nodeId || !claimId || !Number.isInteger(replicaIndex)) {
			// Labelled as ours but not readable as a node. Skipped rather than
			// deleted: something wrote our label, and deleting what we cannot
			// identify is how a controller eats a container it did not create.
			logger.warn(
				`ignoring managed container ${container.Id.slice(0, 12)} with incomplete labels`,
				"ORCHESTRATOR.docker",
			);
			continue;
		}
		const projectId = labels[LABELS.project];
		nodes.push({
			containerId: container.Id,
			nodeId,
			claimId,
			replicaIndex,
			projectId: !projectId || projectId === CATCH_ALL ? null : projectId,
			image: container.Image,
			running: container.State === "running",
			platformState: container.State,
		});
	}
	return nodes;
}

/** Fetches the image. The response is a progress stream nobody needs to read. */
export async function pullImage(image: string): Promise<void> {
	const [name, tag = "latest"] = image.split(":");
	logger.info(`pulling ${image}`, "ORCHESTRATOR.docker");
	const response = await dockerFetch(
		`/images/create?fromImage=${encodeURIComponent(name!)}&tag=${encodeURIComponent(tag)}`,
		{ method: "POST" },
	);
	await response.text();
}

/**
 * Creates and starts one container, returning its id. A missing image is
 * pulled once and the create retried — the first node on a fresh host would
 * otherwise fail forever with a 404 nobody can see.
 */
export async function startNode(spec: ContainerSpec): Promise<string> {
	const create = () =>
		dockerFetch(`/containers/create?name=${encodeURIComponent(spec.name)}`, {
			method: "POST",
			headers: json,
			body: JSON.stringify(spec.body),
		});

	let response: Response;
	try {
		response = await create();
	} catch (error) {
		if (!String(error).includes("(404)")) throw error;
		await pullImage(String((spec.body as { Image: string }).Image));
		response = await create();
	}

	const { Id } = (await response.json()) as { Id: string };
	await dockerFetch(`/containers/${Id}/start`, { method: "POST" });
	return Id;
}

/**
 * Takes a node out of service the way it is meant to go: `stop` sends SIGTERM,
 * which the worker answers by failing its readiness probe so the edge stops
 * sending it work, finishing what is in flight, and releasing its license slot
 * (#336). Docker SIGKILLs it if it overruns `timeoutSec`, so a wedged node
 * still goes away.
 */
export async function drainNode(containerId: string, timeoutSec: number): Promise<void> {
	await dockerFetch(`/containers/${containerId}/stop?t=${timeoutSec}`, { method: "POST" }).catch(
		(error) => {
			// Already stopped is a 304, and a container that vanished is a 404 —
			// both mean the node is not serving, which is what stopping was for.
			logger.warn(
				`stop of ${containerId.slice(0, 12)} did not apply: ${String(error)}`,
				"ORCHESTRATOR.docker",
			);
		},
	);
	await dockerFetch(`/containers/${containerId}?force=true`, { method: "DELETE" });
}
