import { createHash } from "node:crypto";
import type { ScalingPolicy } from "../../lib/instance-settings/schemas";
import { TRIGGERS_STREAM, triggerConsumerName } from "../triggers/subjects";
import {
	assertWellFormed,
	isWellFormedId,
	LABELS,
	MANAGED_BY,
	MANAGED_LABEL,
	READY_PATH,
	SERVES_HTTP,
	type Workload,
	workerEnv,
} from "./containerSpec";
import type { KubeObject } from "./drivers/kubernetesApi";
import type { DesiredNode } from "./projection";

/**
 * What one claim becomes on Kubernetes: a Deployment, a Service and a Traefik
 * IngressRoute when it serves HTTP, and a KEDA ScaledObject — plus the two
 * kinds of Secret that keep credentials out of those objects.
 *
 * Pure, like `containerSpec.ts`, and behind the same checks: every id and host
 * is validated by `assertWellFormed` before it becomes a name, a label or a
 * rule, because a string a user can write must never reach the API server.
 *
 * Docker works per container; Kubernetes per claim. So a claim is one
 * Deployment whose pods are identical, and how many there are is KEDA's to
 * decide between the floor and the ceiling written here.
 */

/** Settings fixed when the driver is built, from the orchestrator's environment. */
export interface KubernetesSpecOptions {
	/** The only image a pod is ever created from. */
	image: string;
	trafficPort: number;
	healthPort: number;
	/** How long a pod may drain after SIGTERM, the same budget Docker's stop gets. */
	drainTimeoutSec: number;
	/** Average use, as a percent of what a node asked for, above which a claim grows. */
	scaleCpuPercent: number;
	scaleMemoryPercent: number;
	/**
	 * NATS's HTTP monitoring, `host:port`, as reachable from KEDA. Unset, no
	 * claim scales on its trigger backlog, only on cpu and memory.
	 */
	natsMonitoringEndpoint?: string;
}

/** One claim, as much as its objects need. */
export interface ClaimWorkload extends Workload {
	resources: DesiredNode["resources"];
	/** Nodes to run at least — the claim's floor, or fewer when the pool or license has no room. */
	min: number;
	/** Nodes KEDA may grow to. Never above what the pool and license leave room for. */
	max: number;
	/** Internal triggers whose backlog this claim scales on. Empty: it scales on cpu and memory. */
	triggerIds: string[];
	/** Triggers reading an outside queue, each scaled on by KEDA's own scaler for it. */
	externalTriggers: ExternalTrigger[];
}

/**
 * A trigger that reads an outside queue, as much as KEDA needs to watch it.
 * Credentials here go only into the trigger's Secret, never into a block.
 */
export type ExternalTrigger = { id: string } & (
	| {
			type: "kafka";
			brokers: string;
			consumerGroup: string;
			topics: string[];
			allowIdleConsumers: boolean;
			tls: boolean;
			sasl: "none" | "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";
			username?: string;
			password?: string;
	  }
	| {
			type: "sqs";
			queueUrl: string;
			region: string;
			endpoint?: string;
			/** Absent: KEDA reads the queue with its own AWS identity. */
			keys?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
	  }
	| {
			type: "nats";
			/** The outside server's HTTP monitoring, `host:port` or a URL, as reachable from KEDA. */
			monitoringEndpoint: string;
			account: string;
			stream: string;
			consumer: string;
	  }
);

/** Shared by every pod: settings copied from the orchestrator, credentials among them. */
export const WORKER_ENV_SECRET = "fluxify-worker-env";

/** 51 characters, so a pod name derived from it stays within a node id's 100. */
export const workloadName = (claimId: string) => `fluxify-worker-${claimId}`;
export const triggerSecretName = (triggerId: string) => `fluxify-trigger-${triggerId}`;
/** Marks the objects that belong to one trigger rather than to a claim. */
export const TRIGGER_LABEL = "fluxify.trigger-id";

const ANNOTATIONS = {
	host: "fluxify.host",
	/** Changes when the shared env does, so the pods restart and read it again. */
	envHash: "fluxify.env-hash",
	/** Changes when a trigger's credentials do, so KEDA rebuilds that scaler. */
	secretsHash: "fluxify.trigger-secrets-hash",
} as const;

/** Short, stable digest of string values, independent of key order. */
export function contentHash(values: Record<string, string>) {
	const sorted = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
	return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

/**
 * Desired nodes, one per replica, turned into one workload per claim.
 *
 * A claim with no placeable node gets no workload at all: whether its objects
 * stay (a lapsed license keeps running nodes, §12) or go (a shrunk pool) is the
 * reconciler's decision, not something to express as zero replicas here.
 *
 * `triggersByGroup` holds only internal triggers with a workflow attached — the
 * ones with a consumer on the trigger stream whose backlog means something.
 */
export function claimWorkloads(
	desired: readonly DesiredNode[],
	ceilings: ReadonlyMap<string, number>,
	triggersByGroup: ReadonlyMap<string, readonly string[]>,
	externalByGroup: ReadonlyMap<string, readonly ExternalTrigger[]> = new Map(),
): ClaimWorkload[] {
	const byClaim = new Map<string, DesiredNode[]>();
	for (const node of desired) {
		byClaim.set(node.claimId, [...(byClaim.get(node.claimId) ?? []), node]);
	}

	const workloads: ClaimWorkload[] = [];
	for (const [claimId, nodes] of byClaim) {
		const placeable = nodes.filter((node) => node.placeable).length;
		if (placeable === 0) continue;
		const { projectId, type, groupIds, host, resources } = nodes[0]!;
		// Short of room for its own floor, a claim must not grow either: a pod past
		// the license exits on boot, and KEDA would start another forever.
		const max =
			placeable < nodes.length ? placeable : Math.max(placeable, ceilings.get(claimId) ?? 0);
		// Only a project's workflow claim names every trigger it runs. A catch-all
		// would need every trigger in the instance, and `both` mixes HTTP load in.
		const scalesOnBacklog = type === "workflow" && projectId !== null;
		workloads.push({
			claimId,
			projectId,
			type,
			groupIds,
			host: host ?? null,
			resources,
			min: placeable,
			max,
			triggerIds: scalesOnBacklog ? groupIds.flatMap((id) => triggersByGroup.get(id) ?? []) : [],
			externalTriggers: scalesOnBacklog
				? groupIds.flatMap((id) => externalByGroup.get(id) ?? [])
				: [],
		});
	}
	return workloads;
}

function labels(workload: ClaimWorkload): Record<string, string> {
	return {
		[MANAGED_LABEL]: MANAGED_BY,
		[LABELS.claim]: workload.claimId,
		// A catch-all has no project, and `*` is not a valid label value.
		...(workload.projectId ? { [LABELS.project]: workload.projectId } : {}),
	};
}

const servesHttp = (workload: ClaimWorkload) =>
	SERVES_HTTP.includes(workload.type) && (workload.projectId === null || !!workload.host);

/**
 * The claim's Deployment, without a replica count: that is `buildReplicas`'s,
 * written under its own field manager. Leaving a field out of an apply resets
 * it when nobody else owns it, so if this object ever carried the count,
 * handing it to KEDA would first drop the claim to one pod.
 */
export function buildDeployment(
	workload: ClaimWorkload,
	options: KubernetesSpecOptions,
	sharedEnv: Record<string, string>,
	licenseCapped: boolean,
): KubeObject {
	assertWellFormed(workload);
	const env = workerEnv(workload, options);
	const size = {
		cpu: String(workload.resources.cpu),
		memory: `${workload.resources.memoryMb}Mi`,
	};
	return {
		apiVersion: "apps/v1",
		kind: "Deployment",
		metadata: { name: workloadName(workload.claimId), labels: labels(workload) },
		spec: {
			selector: { matchLabels: { [MANAGED_LABEL]: MANAGED_BY, [LABELS.claim]: workload.claimId } },
			// Under a node cap, stop the old pod before starting its replacement
			// (#466): a surge pod finds no free slot at the cap and crash-loops,
			// so the default surge-first rollout never finishes. The cost is a
			// 1-replica claim briefly down, the same as on Docker. Keyed on the
			// license, not on the live count, so the spec never flaps with
			// other claims. Uncapped keeps Kubernetes' zero-downtime default.
			...(licenseCapped
				? { strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 0, maxUnavailable: 1 } } }
				: {}),
			template: {
				metadata: {
					labels: labels(workload),
					annotations: {
						[ANNOTATIONS.envHash]: contentHash(sharedEnv),
						...(workload.host ? { [ANNOTATIONS.host]: workload.host } : {}),
					},
				},
				spec: {
					// The worker drains on SIGTERM; this is how long it is given.
					terminationGracePeriodSeconds: options.drainTimeoutSec,
					// Workers talk to NATS, not to the API server.
					automountServiceAccountToken: false,
					containers: [
						{
							name: "worker",
							image: options.image,
							imagePullPolicy: "IfNotPresent",
							env: [
								...Object.entries(env).map(([name, value]) => ({ name, value })),
								// The pod's own name is its node id: nothing else about a
								// Deployment's pods is unique, and it is known only once it runs.
								{
									name: "FLUXIFY_NODE_ID",
									valueFrom: { fieldRef: { fieldPath: "metadata.name" } },
								},
							],
							envFrom: [{ secretRef: { name: WORKER_ENV_SECRET } }],
							ports: [
								{ name: "http", containerPort: options.trafficPort },
								{ name: "health", containerPort: options.healthPort },
							],
							readinessProbe: {
								httpGet: { path: READY_PATH, port: "health" },
								periodSeconds: 5,
							},
							// Requests equal to limits: what autoscaling measures against is
							// then exactly what the node may use.
							resources: { requests: size, limits: size },
						},
					],
				},
			},
		},
	};
}

/** Field manager for the replica count alone, so the Deployment's own apply never owns it. */
export const REPLICAS_MANAGER = "fluxify-orchestrator-replicas";

/**
 * The claim's replica count, as an apply of its own. Written only while no
 * ScaledObject owns the Deployment: once KEDA does, the count is its number,
 * and a second writer would make the Deployment flap between the two.
 */
export function buildReplicas(workload: ClaimWorkload): KubeObject {
	assertWellFormed(workload);
	return {
		apiVersion: "apps/v1",
		kind: "Deployment",
		metadata: { name: workloadName(workload.claimId) },
		spec: { replicas: workload.min },
	};
}

/** A stable address in front of the claim's ready pods. Only for a claim the edge routes to. */
export function buildService(
	workload: ClaimWorkload,
	options: KubernetesSpecOptions,
): KubeObject | null {
	assertWellFormed(workload);
	if (!servesHttp(workload)) return null;
	return {
		apiVersion: "v1",
		kind: "Service",
		metadata: { name: workloadName(workload.claimId), labels: labels(workload) },
		spec: {
			selector: { [MANAGED_LABEL]: MANAGED_BY, [LABELS.claim]: workload.claimId },
			ports: [{ name: "http", port: options.trafficPort, targetPort: "http" }],
		},
	};
}

/**
 * The same routing decision the Docker driver writes as labels: a project's
 * host above the catch-all, the catch-all's `PathPrefix(/)` below everything,
 * and the admin's own rule above both. Traefik's resource has a real priority
 * field, which a plain Ingress lacks.
 */
export function buildIngressRoute(
	workload: ClaimWorkload,
	options: KubernetesSpecOptions,
): KubeObject | null {
	assertWellFormed(workload);
	if (!servesHttp(workload)) return null;
	const catchAll = workload.projectId === null;
	return {
		apiVersion: "traefik.io/v1alpha1",
		kind: "IngressRoute",
		metadata: { name: workloadName(workload.claimId), labels: labels(workload) },
		spec: {
			entryPoints: ["web"],
			routes: [
				{
					kind: "Rule",
					match: catchAll ? "PathPrefix(`/`)" : `Host(\`${workload.host}\`)`,
					priority: catchAll ? 1 : 50,
					services: [{ name: workloadName(workload.claimId), port: options.trafficPort }],
				},
			],
		},
	};
}

/**
 * How KEDA sizes the claim: never below `min`, never above `max`, and on the
 * signal that fits the work. A project's workflow claim scales on each of its
 * triggers' backlog — KEDA takes whichever asks for most, so nothing adds them
 * up first. Everything else scales on cpu and memory.
 *
 * Triggers on an outside queue add KEDA's own scaler for that queue, next to
 * the internal ones. `secretsHash` covers their credentials: KEDA does not
 * notice a Secret change on its own, and a new annotation rebuilds the scalers.
 */
export function buildScaledObject(
	workload: ClaimWorkload,
	options: KubernetesSpecOptions,
	policy: ScalingPolicy,
	secretsHash?: string,
): KubeObject {
	assertWellFormed(workload);
	const badTrigger = [...workload.triggerIds, ...workload.externalTriggers.map((t) => t.id)].find(
		(id) => !isWellFormedId(id),
	);
	if (badTrigger) throw new Error(`refusing a malformed trigger id: ${badTrigger}`);

	const backlog: object[] = options.natsMonitoringEndpoint
		? workload.triggerIds.map((triggerId) => ({
				type: "nats-jetstream",
				metadata: {
					natsServerMonitoringEndpoint: options.natsMonitoringEndpoint,
					// The account a server without accounts puts everyone in.
					account: "$G",
					stream: TRIGGERS_STREAM,
					consumer: triggerConsumerName(triggerId),
					lagThreshold: String(policy.queuedPerNode),
				},
			}))
		: [];
	backlog.push(...workload.externalTriggers.map((trigger) => externalScaler(trigger, policy)));
	const load = [
		{
			type: "cpu",
			metricType: "Utilization",
			metadata: { value: String(options.scaleCpuPercent) },
		},
		{
			type: "memory",
			metricType: "Utilization",
			metadata: { value: String(options.scaleMemoryPercent) },
		},
	];

	return {
		apiVersion: "keda.sh/v1alpha1",
		kind: "ScaledObject",
		metadata: {
			name: workloadName(workload.claimId),
			labels: labels(workload),
			...(secretsHash ? { annotations: { [ANNOTATIONS.secretsHash]: secretsHash } } : {}),
		},
		spec: {
			scaleTargetRef: { name: workloadName(workload.claimId) },
			minReplicaCount: workload.min,
			maxReplicaCount: workload.max,
			pollingInterval: policy.pollIntervalSec,
			advanced: {
				horizontalPodAutoscalerConfig: {
					// Growing is never delayed; shrinking waits for the load to stay low.
					// Not KEDA's cooldownPeriod: that only applies to scaling to zero,
					// and a claim's floor is at least one.
					behavior: { scaleDown: { stabilizationWindowSeconds: policy.scaleDownWindowSec } },
				},
			},
			triggers: backlog.length ? backlog : load,
		},
	};
}

function secret(
	name: string,
	extraLabels: Record<string, string>,
	data: Record<string, string>,
): KubeObject {
	return {
		apiVersion: "v1",
		kind: "Secret",
		metadata: { name, labels: { [MANAGED_LABEL]: MANAGED_BY, ...extraLabels } },
		type: "Opaque",
		// `data` rather than `stringData`: the write-only form would leave a key
		// behind after it was dropped here, since the stored object never has it.
		data: Object.fromEntries(
			Object.entries(data).map(([key, value]) => [key, Buffer.from(value).toString("base64")]),
		),
	};
}

/** The settings every worker copies from the orchestrator, kept out of the Deployments. */
export function buildWorkerEnvSecret(env: Record<string, string>): KubeObject {
	return secret(WORKER_ENV_SECRET, {}, env);
}

/**
 * One trigger's connection credentials, named by the trigger so it is found
 * and rewritten without a lookup. The orchestrator writes it every pass from
 * the database, so a missed update is corrected by the next pass.
 */
export function buildTriggerSecret(triggerId: string, data: Record<string, string>): KubeObject {
	if (!isWellFormedId(triggerId)) throw new Error(`refusing a malformed trigger id: ${triggerId}`);
	return secret(triggerSecretName(triggerId), { [TRIGGER_LABEL]: triggerId }, data);
}

/** Where KEDA's HTTP call to a NATS monitoring endpoint goes: `host:port`, and whether over https. */
function monitoring(endpoint: string) {
	const https = endpoint.startsWith("https://");
	return { host: endpoint.replace(/^https?:\/\//, "").replace(/\/$/, ""), https };
}

/** The ScaledObject block for one outside queue. Nothing secret: that is in its authentication. */
export function externalScaler(trigger: ExternalTrigger, policy: ScalingPolicy) {
	const threshold = String(policy.queuedPerNode);
	const authenticationRef = { name: triggerSecretName(trigger.id) };
	switch (trigger.type) {
		case "kafka":
			return {
				type: "kafka",
				metadata: {
					bootstrapServers: trigger.brokers,
					consumerGroup: trigger.consumerGroup,
					// One topic is named; with several, KEDA sums every topic the group reads.
					...(trigger.topics.length === 1 ? { topic: trigger.topics[0]! } : {}),
					lagThreshold: threshold,
					allowIdleConsumers: String(trigger.allowIdleConsumers),
				},
				authenticationRef,
			};
		case "sqs":
			return {
				type: "aws-sqs-queue",
				metadata: {
					queueURL: trigger.queueUrl,
					queueLength: threshold,
					awsRegion: trigger.region,
					...(trigger.endpoint ? { awsEndpoint: trigger.endpoint } : {}),
				},
				authenticationRef,
			};
		case "nats": {
			const { host, https } = monitoring(trigger.monitoringEndpoint);
			return {
				type: "nats-jetstream",
				metadata: {
					natsServerMonitoringEndpoint: host,
					account: trigger.account,
					stream: trigger.stream,
					consumer: trigger.consumer,
					lagThreshold: threshold,
					...(https ? { useHttps: "true" } : {}),
				},
			};
		}
	}
}

/** What an outside queue's credentials become: the Secret's keys, named as KEDA reads them. */
export function externalSecretData(trigger: ExternalTrigger): Record<string, string> | null {
	if (trigger.type === "kafka") {
		const sasl = {
			none: "none",
			PLAIN: "plaintext",
			"SCRAM-SHA-256": "scram_sha256",
			"SCRAM-SHA-512": "scram_sha512",
		}[trigger.sasl];
		return {
			sasl,
			tls: trigger.tls ? "enable" : "disable",
			...(trigger.username ? { username: trigger.username } : {}),
			...(trigger.password ? { password: trigger.password } : {}),
		};
	}
	if (trigger.type === "sqs" && trigger.keys) {
		return {
			awsAccessKeyID: trigger.keys.accessKeyId,
			awsSecretAccessKey: trigger.keys.secretAccessKey,
			...(trigger.keys.sessionToken ? { awsSessionToken: trigger.keys.sessionToken } : {}),
		};
	}
	// NATS's scaler reads only the monitoring endpoint; SQS without keys uses KEDA's identity.
	return null;
}

/**
 * How KEDA authenticates one trigger's scaler: every key of its Secret, or,
 * for SQS without keys, KEDA's own AWS identity. Named like the Secret, so a
 * block finds it without a lookup. NATS needs none.
 */
export function buildTriggerAuthentication(
	trigger: ExternalTrigger,
	data: Record<string, string> | null,
): KubeObject | null {
	if (!isWellFormedId(trigger.id))
		throw new Error(`refusing a malformed trigger id: ${trigger.id}`);
	if (trigger.type === "nats") return null;
	const spec = data
		? {
				secretTargetRef: Object.keys(data).map((key) => ({
					parameter: key,
					name: triggerSecretName(trigger.id),
					key,
				})),
			}
		: { podIdentity: { provider: "aws", identityOwner: "keda" } };
	return {
		apiVersion: "keda.sh/v1alpha1",
		kind: "TriggerAuthentication",
		metadata: {
			name: triggerSecretName(trigger.id),
			labels: { [MANAGED_LABEL]: MANAGED_BY, [TRIGGER_LABEL]: trigger.id },
		},
		spec,
	};
}
