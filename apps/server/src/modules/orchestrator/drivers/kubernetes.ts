import { logger } from "@fluxify/common";
import { LABELS, MANAGED_BY, MANAGED_LABEL } from "../containerSpec";
import {
	type Applied,
	objectHash,
	objectKey,
	planKubernetes,
	podsToNodes,
} from "../kubernetesPlan";
import {
	buildDeployment,
	buildIngressRoute,
	buildReplicas,
	buildScaledObject,
	buildService,
	buildWorkerEnvSecret,
	type ClaimWorkload,
	claimWorkloads,
	type KubernetesSpecOptions,
	REPLICAS_MANAGER,
	workloadName,
} from "../kubernetesSpec";
import type { NodeEvent } from "../records";
import type { ScalingContext } from "../scaling";
import { createKubeApi, type Kind, type KubeApi, type KubeObject } from "./kubernetesApi";
import type { InfraDriver } from "./platform";

/**
 * Kubernetes as a driver: one Deployment per claim, with its Service,
 * IngressRoute and ScaledObject, planned by `kubernetesPlan.ts` and sent
 * through `kubernetesApi.ts`.
 *
 * What is running is read from the API server, never by calling pods over
 * HTTP: a pod's IP is not reliably reachable from outside the cluster, which
 * is why liveness is on NATS. The health endpoint stays for the readiness
 * probe — two consumers of one endpoint.
 *
 * Only objects carrying this orchestrator's label are listed, so nothing else
 * in the namespace is ever seen, let alone changed.
 */

export interface KubernetesDriverOptions extends KubernetesSpecOptions {
	/** Broker address, encryption key, log shipping — copied from this process into a Secret. */
	passthroughEnv: Record<string, string>;
}

const SELECTOR = `${MANAGED_LABEL}=${MANAGED_BY}`;
const OWNED: Kind[] = ["Deployment", "Service", "IngressRoute", "ScaledObject", "Secret"];

/** Worst first, so one event per claim says the most important thing that happened. */
const ACTIONS = ["created", "updated", "restored", "scaled"] as const;
type Action = (typeof ACTIONS)[number];

export function createKubernetesDriver(
	options: KubernetesDriverOptions,
	api: KubeApi = createKubeApi(),
): InfraDriver {
	/**
	 * What was last sent for each object. In memory on purpose: after a restart
	 * it is empty, every object is applied once, and an apply that changes
	 * nothing costs nothing.
	 */
	const applied = new Map<string, Applied>();
	// ponytail: a kind found missing (no KEDA, no Traefik) is not retried until a
	// restart. Re-probe it every few minutes if installing one live matters.
	const absent = new Set<Kind>();

	function objectsFor(workload: ClaimWorkload, scaling: ScalingContext) {
		return [
			buildDeployment(workload, options, options.passthroughEnv),
			buildService(workload, options),
			buildIngressRoute(workload, options),
			buildScaledObject(workload, options, scaling.policy),
		].filter((object): object is KubeObject => object !== null);
	}

	return {
		provider: "kubernetes",
		meta: {
			endpoint: api.endpoint.base,
			namespace: api.endpoint.namespace,
			workerImage: options.image,
		},
		reachable: api.reachable,

		async observe() {
			return podsToNodes(await api.list("Pod", SELECTOR));
		},

		async apply(desired, _observed, { scaling }) {
			const events: NodeEvent[] = [];
			const fail = (claimId: string, projectId: string | null, action: string, error: unknown) => {
				logger.error(`${action} for claim ${claimId}: ${String(error)}`, "ORCHESTRATOR.kubernetes");
				events.push({
					claimId,
					projectId,
					action,
					reason: "start_failed",
					detail: { error: String(error) },
				});
			};

			const workloads = claimWorkloads(desired, scaling.ceilings, scaling.triggersByGroup);
			const wanted: KubeObject[] = [buildWorkerEnvSecret(options.passthroughEnv)];
			const claimOf = new Map<string, ClaimWorkload>();
			for (const workload of workloads) {
				try {
					for (const object of objectsFor(workload, scaling)) {
						if (absent.has(object.kind)) continue;
						wanted.push(object);
						claimOf.set(objectKey(object), workload);
					}
				} catch (error) {
					// A malformed id is refused before anything is sent (§13).
					fail(workload.claimId, workload.projectId, "apply_failed", error);
				}
			}

			// A claim with nothing placeable has no workload. Its objects stay while
			// the license is what stops it (§12) and go when the pool shrank, which is
			// the operator's own decision — the same line the Docker plan draws.
			const placed = new Set(workloads.map((workload) => workload.claimId));
			const keep = new Set(
				desired
					.filter((node) => !placed.has(node.claimId) && node.reason !== "pool_unavailable")
					.map((node) => node.claimId),
			);

			const observed = (await Promise.all(OWNED.map((kind) => api.list(kind, SELECTOR)))).flat();
			const found = new Map(observed.map((object) => [objectKey(object), object]));
			const plan = planKubernetes({ wanted, observed, applied, keep });

			const happened = new Map<string, Action>();
			const note = (claimId: string, action: Action) => {
				const was = happened.get(claimId);
				if (!was || ACTIONS.indexOf(action) < ACTIONS.indexOf(was)) happened.set(claimId, action);
			};

			const removedClaims = new Set<string>();
			for (const object of plan.remove) {
				const claimId = object.metadata.labels?.[LABELS.claim];
				try {
					await api.remove(object.kind, object.metadata.name);
					applied.delete(objectKey(object));
				} catch (error) {
					logger.error(
						`removing ${objectKey(object)} failed: ${String(error)}`,
						"ORCHESTRATOR.kubernetes",
					);
					continue;
				}
				if (!claimId || removedClaims.has(claimId)) continue;
				// A live claim that stopped needing an object: its type changed.
				if (placed.has(claimId)) {
					note(claimId, "updated");
					continue;
				}
				removedClaims.add(claimId);
				const shrunk = desired.some((node) => node.claimId === claimId);
				events.push({
					claimId,
					projectId: object.metadata.labels?.[LABELS.project] ?? null,
					action: "removed",
					reason: shrunk ? "pool_unavailable" : "draining",
					detail: { cause: shrunk ? "pool_unavailable" : "orphan" },
				});
			}

			const stored = new Map<string, KubeObject>();

			for (const object of plan.apply) {
				const key = objectKey(object);
				const workload = claimOf.get(key);
				const current = found.get(key);
				const last = applied.get(key);
				try {
					const result = await api.apply(object);
					if (!result) {
						absent.add(object.kind);
						continue;
					}
					stored.set(key, result);
					applied.set(key, { hash: objectHash(object), generation: result.metadata.generation });
					if (!workload) continue;
					const changedSpec = result.metadata.generation !== current?.metadata.generation;
					if (!current)
						note(workload.claimId, object.kind === "Deployment" ? "created" : "updated");
					else if (last && last.hash !== objectHash(object))
						note(workload.claimId, object.kind === "ScaledObject" ? "scaled" : "updated");
					// Sent because the generation moved. If ours changed it back, someone
					// else had edited it; if not, it was only the autoscaler resizing.
					else if (changedSpec) note(workload.claimId, last ? "restored" : "updated");
				} catch (error) {
					if (workload) fail(workload.claimId, workload.projectId, "apply_failed", error);
					else logger.error(`applying ${key} failed: ${String(error)}`, "ORCHESTRATOR.kubernetes");
				}
			}

			// The replica count, only where no ScaledObject owns it: KEDA not
			// installed, or not created yet. Its own field manager, so the
			// Deployment's apply never owns the field and handing it over never
			// resets it.
			for (const workload of workloads) {
				const name = workloadName(workload.claimId);
				if (found.has(`ScaledObject/${name}`) || stored.has(`ScaledObject/${name}`)) continue;
				const deployment = stored.get(`Deployment/${name}`) ?? found.get(`Deployment/${name}`);
				if (!deployment) continue;
				const replicas = (deployment.spec as { replicas?: number } | undefined)?.replicas;
				if (replicas === workload.min) continue;
				try {
					const result = await api.apply(buildReplicas(workload), REPLICAS_MANAGER);
					const last = applied.get(`Deployment/${name}`);
					// Our own resize bumps the generation; it is not someone else's edit.
					if (last && result) last.generation = result.metadata.generation;
					if (found.has(`Deployment/${name}`)) note(workload.claimId, "scaled");
				} catch (error) {
					fail(workload.claimId, workload.projectId, "scale_failed", error);
				}
			}

			for (const workload of workloads) {
				const action = happened.get(workload.claimId);
				if (!action) continue;
				logger.info(`claim ${workload.claimId} ${action}`, "ORCHESTRATOR.kubernetes");
				events.push({
					claimId: workload.claimId,
					projectId: workload.projectId,
					action,
					detail: { min: workload.min, max: workload.max },
				});
			}
			return events;
		},
	};
}
