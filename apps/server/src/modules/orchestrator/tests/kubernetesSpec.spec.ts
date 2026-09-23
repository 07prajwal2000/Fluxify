import { describe, expect, it } from "bun:test";
import { DEFAULT_RESOURCES } from "../claimMetadata";
import { LABELS, MANAGED_LABEL } from "../containerSpec";
import {
	buildDeployment,
	buildIngressRoute,
	buildReplicas,
	buildScaledObject,
	buildService,
	buildTriggerAuthentication,
	buildTriggerSecret,
	buildWorkerEnvSecret,
	type ClaimWorkload,
	claimWorkloads,
	contentHash,
	type ExternalTrigger,
	externalSecretData,
	type KubernetesSpecOptions,
	WORKER_ENV_SECRET,
} from "../kubernetesSpec";
import type { DesiredNode } from "../projection";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";
const PROJECT = "0192b1c4-2222-7000-8000-000000000002";
const GROUP = "0192b1c4-3333-7000-8000-000000000003";
const TRIGGER_A = "0192b1c4-4444-7000-8000-000000000004";
const TRIGGER_B = "0192b1c4-5555-7000-8000-000000000005";

const options: KubernetesSpecOptions = {
	image: "fluxify-worker-compiled:latest",
	trafficPort: 5600,
	healthPort: 5601,
	drainTimeoutSec: 35,
	scaleCpuPercent: 65,
	scaleMemoryPercent: 70,
	natsMonitoringEndpoint: "nats.fluxify.svc:8222",
};
const policy = { queuedPerNode: 10, pollIntervalSec: 30, scaleDownWindowSec: 300 };

const workload = (over: Partial<ClaimWorkload> = {}): ClaimWorkload => ({
	claimId: CLAIM,
	projectId: null,
	type: "both",
	groupIds: [],
	host: null,
	resources: DEFAULT_RESOURCES,
	min: 1,
	max: 1,
	triggerIds: [],
	externalTriggers: [],
	...over,
});

const node = (replicaIndex: number, over: Partial<DesiredNode> = {}): DesiredNode => ({
	claimId: CLAIM,
	replicaIndex,
	projectId: PROJECT,
	type: "workflow",
	groupIds: [GROUP],
	excludedGroups: [],
	resources: DEFAULT_RESOURCES,
	placeable: true,
	reason: null,
	...over,
});

// biome-ignore lint/suspicious/noExplicitAny: reading into a manifest
const spec = (object: { [key: string]: unknown }) => object.spec as any;

describe("claimWorkloads", () => {
	const triggers = new Map([[GROUP, [TRIGGER_A, TRIGGER_B]]]);

	it("turns a claim's replicas into one workload, free to grow to its ceiling", () => {
		const [only, ...rest] = claimWorkloads([node(0), node(1)], new Map([[CLAIM, 5]]), triggers);
		expect(rest).toEqual([]);
		expect(only).toMatchObject({ claimId: CLAIM, min: 2, max: 5 });
	});

	it("scales a project's workflow claim on each trigger in its groups", () => {
		const [only] = claimWorkloads([node(0)], new Map(), triggers);
		expect(only!.triggerIds).toEqual([TRIGGER_A, TRIGGER_B]);
	});

	it("scales everything else on load: a catch-all, and a claim that also serves HTTP", () => {
		const catchAll = claimWorkloads([node(0, { projectId: null })], new Map(), triggers);
		const both = claimWorkloads([node(0, { type: "both" })], new Map(), triggers);
		expect(catchAll[0]!.triggerIds).toEqual([]);
		expect(both[0]!.triggerIds).toEqual([]);
	});

	it("holds a claim short of room for its floor at what fits — a pod past the license exits on boot", () => {
		const nodes = [node(0), node(1, { placeable: false, reason: "no_license_slot" })];
		const [only] = claimWorkloads(nodes, new Map([[CLAIM, 4]]), triggers);
		expect(only).toMatchObject({ min: 1, max: 1 });
	});

	it("leaves a claim with nothing placeable to the reconciler rather than scaling it to zero", () => {
		const nodes = [node(0, { placeable: false, reason: "pool_unavailable" })];
		expect(claimWorkloads(nodes, new Map(), triggers)).toEqual([]);
	});
});

describe("buildDeployment", () => {
	const shared = { NATS_URL: "nats://nats:4222", MASTER_ENCRYPTION_KEY: "k" };
	const deployment = (over: Partial<ClaimWorkload> = {}) =>
		buildDeployment(workload(over), options, shared);
	const container = (object: ReturnType<typeof deployment>) =>
		spec(object).template.spec.containers[0];

	it("leaves the replica count to its own apply, so handing it to KEDA never resets it", () => {
		expect(spec(deployment({ min: 3 }))).not.toHaveProperty("replicas");
		expect(spec(buildReplicas(workload({ min: 3 })))).toEqual({ replicas: 3 });
	});

	it("gives each pod its own name as node id, and the claim it belongs to", () => {
		const env = container(deployment()).env;
		expect(env).toContainEqual({
			name: "FLUXIFY_NODE_ID",
			valueFrom: { fieldRef: { fieldPath: "metadata.name" } },
		});
		expect(env).toContainEqual({ name: "FLUXIFY_CLAIM_ID", value: CLAIM });
		expect(env).toContainEqual({ name: "WORKER_PROJECT_ID", value: "*" });
	});

	it("keeps the shared settings in a Secret, never written into the Deployment", () => {
		const object = deployment();
		expect(container(object).envFrom).toEqual([{ secretRef: { name: WORKER_ENV_SECRET } }]);
		expect(JSON.stringify(object)).not.toContain("nats://nats:4222");
	});

	it("restarts the pods when the shared settings change, since a Secret change alone does not", () => {
		const hash = (env: Record<string, string>) =>
			spec(buildDeployment(workload(), options, env)).template.metadata
				.annotations["fluxify.env-hash"];
		expect(hash(shared)).not.toBe(hash({ ...shared, NATS_URL: "nats://other:4222" }));
	});

	it("asks for exactly the claim's size, which is what cpu and memory scaling measure against", () => {
		const resources = container(deployment({ resources: { cpu: 1.5, memoryMb: 768 } })).resources;
		expect(resources).toEqual({
			requests: { cpu: "1.5", memory: "768Mi" },
			limits: { cpu: "1.5", memory: "768Mi" },
		});
	});

	it("takes a draining pod off traffic before it stops, and gives it the drain budget", () => {
		const object = deployment();
		expect(container(object).readinessProbe.httpGet).toEqual({
			path: "/_/admin/api/healthchecks/ready",
			port: "health",
		});
		expect(spec(object).template.spec.terminationGracePeriodSeconds).toBe(35);
	});

	it("labels everything as the orchestrator's, and selects only this claim's pods", () => {
		const object = deployment({ projectId: PROJECT, host: "shop.example.com" });
		expect(object.metadata.labels![MANAGED_LABEL]).toBe("orchestrator");
		expect(spec(object).selector.matchLabels).toEqual({
			[MANAGED_LABEL]: "orchestrator",
			[LABELS.claim]: CLAIM,
		});
		expect(spec(object).template.metadata.labels[LABELS.project]).toBe(PROJECT);
	});
});

describe("the edge: Service and IngressRoute", () => {
	it("routes the catch-all on every path, below everything else", () => {
		const route = spec(buildIngressRoute(workload(), options)!).routes[0];
		expect(route).toMatchObject({ match: "PathPrefix(`/`)", priority: 1 });
		expect(route.services).toEqual([{ name: `fluxify-worker-${CLAIM}`, port: 5600 }]);
	});

	it("routes a project on its own host, above the catch-all", () => {
		const route = spec(
			buildIngressRoute(workload({ projectId: PROJECT, host: "shop.example.com" }), options)!,
		).routes[0];
		expect(route).toMatchObject({ match: "Host(`shop.example.com`)", priority: 50 });
	});

	it("puts nothing in front of a claim with no HTTP to serve", () => {
		expect(buildService(workload({ type: "workflow" }), options)).toBeNull();
		expect(buildIngressRoute(workload({ type: "workflow" }), options)).toBeNull();
		// a project with no host yet has nowhere to be routed from
		expect(buildIngressRoute(workload({ projectId: PROJECT }), options)).toBeNull();
	});

	it("sends a Service to the claim's pods on the traffic port", () => {
		expect(spec(buildService(workload(), options)!)).toEqual({
			selector: { [MANAGED_LABEL]: "orchestrator", [LABELS.claim]: CLAIM },
			ports: [{ name: "http", port: 5600, targetPort: "http" }],
		});
	});
});

describe("buildScaledObject", () => {
	it("scales between the floor and the ceiling, and waits before shrinking", () => {
		const scaled = spec(buildScaledObject(workload({ min: 2, max: 6 }), options, policy));
		expect(scaled).toMatchObject({ minReplicaCount: 2, maxReplicaCount: 6, pollingInterval: 30 });
		expect(scaled.advanced.horizontalPodAutoscalerConfig.behavior.scaleDown).toEqual({
			stabilizationWindowSeconds: 300,
		});
	});

	it("reads each trigger's backlog from its own consumer", () => {
		const triggers = spec(
			buildScaledObject(workload({ triggerIds: [TRIGGER_A, TRIGGER_B] }), options, policy),
		).triggers;
		expect(triggers).toHaveLength(2);
		expect(triggers[0]).toEqual({
			type: "nats-jetstream",
			metadata: {
				natsServerMonitoringEndpoint: "nats.fluxify.svc:8222",
				account: "$G",
				stream: "FLUXIFY_TRIGGERS",
				consumer: `fluxify_trigger_${TRIGGER_A}`,
				lagThreshold: "10",
			},
		});
	});

	it("falls back to cpu and memory with no triggers, or nowhere to read their backlog", () => {
		const types = (over: Partial<ClaimWorkload>, opts = options) =>
			spec(buildScaledObject(workload(over), opts, policy)).triggers.map(
				(trigger: { type: string }) => trigger.type,
			);
		expect(types({})).toEqual(["cpu", "memory"]);
		expect(types({ triggerIds: [TRIGGER_A] }, { ...options, natsMonitoringEndpoint: undefined })).toEqual([
			"cpu",
			"memory",
		]);
	});

	it("carries a hash of its triggers' credentials, so KEDA rebuilds a scaler when they change", () => {
		const scaled = buildScaledObject(workload(), options, policy, "abc123");
		expect(scaled.metadata.annotations).toEqual({ "fluxify.trigger-secrets-hash": "abc123" });
		expect(buildScaledObject(workload(), options, policy).metadata).not.toHaveProperty("annotations");
	});
});

describe("secrets", () => {
	it("names a trigger's secret by the trigger, so it is found without a lookup", () => {
		const secret = buildTriggerSecret(TRIGGER_A, { password: "hunter2" });
		expect(secret.metadata.name).toBe(`fluxify-trigger-${TRIGGER_A}`);
		expect(secret.data).toEqual({ password: Buffer.from("hunter2").toString("base64") });
	});

	it("keeps the workers' shared settings under one name every Deployment reads", () => {
		expect(buildWorkerEnvSecret({ A: "1" }).metadata.name).toBe(WORKER_ENV_SECRET);
	});

	it("hashes the same values the same way, whatever order they come in", () => {
		expect(contentHash({ a: "1", b: "2" })).toBe(contentHash({ b: "2", a: "1" }));
		expect(contentHash({ a: "1" })).not.toBe(contentHash({ a: "2" }));
	});
});

describe("no string a user can write reaches the API server", () => {
	it("refuses a host that would end the Traefik rule and start another", () => {
		const bad = workload({ projectId: PROJECT, host: "a.com`) || PathPrefix(`/" });
		expect(() => buildIngressRoute(bad, options)).toThrow("malformed host");
		expect(() => buildDeployment(bad, options, {})).toThrow("malformed host");
	});

	it("refuses ids that are not the shape the database generates", () => {
		expect(() => buildScaledObject(workload({ claimId: "../x" }), options, policy)).toThrow();
		expect(() => buildService(workload({ groupIds: ["$(whoami)"] }), options)).toThrow();
		expect(() =>
			buildScaledObject(workload({ triggerIds: ["a/b"] }), options, policy),
		).toThrow("malformed trigger id");
		expect(() => buildTriggerSecret("../../etc", {})).toThrow("malformed trigger id");
	});
});

describe("triggers on an outside queue", () => {
	const kafka: ExternalTrigger = {
		id: TRIGGER_A,
		type: "kafka",
		brokers: "kafka:9092",
		consumerGroup: `fluxify-${TRIGGER_A}`,
		topics: ["orders"],
		allowIdleConsumers: true,
		tls: false,
		sasl: "SCRAM-SHA-256",
		username: "user",
		password: "hunter2",
	};
	const sqs: ExternalTrigger = {
		id: TRIGGER_B,
		type: "sqs",
		queueUrl: "https://sqs.eu-west-1.amazonaws.com/1/orders",
		region: "eu-west-1",
	};
	const nats: ExternalTrigger = {
		id: TRIGGER_B,
		type: "nats",
		monitoringEndpoint: "https://nats.example.com:8222/",
		account: "$G",
		stream: "ORDERS",
		consumer: "orders",
	};
	const scaled = (externalTriggers: ExternalTrigger[]) =>
		buildScaledObject(workload({ externalTriggers }), options, policy, "abc") as {
			metadata: { annotations?: Record<string, string> };
			spec: { triggers: { type: string; metadata: Record<string, string> }[] };
		};

	it("adds a block per trigger, next to the internal ones, with no credential in it", () => {
		const object = scaled([kafka]);
		const [block] = object.spec.triggers;
		expect(block).toMatchObject({
			type: "kafka",
			metadata: { topic: "orders", lagThreshold: "10", allowIdleConsumers: "true" },
			authenticationRef: { name: `fluxify-trigger-${TRIGGER_A}` },
		});
		expect(JSON.stringify(object)).not.toContain("hunter2");
		expect(object.metadata.annotations?.["fluxify.trigger-secrets-hash"]).toBe("abc");
	});

	it("names no topic when a trigger reads several, so KEDA sums them", () => {
		expect(scaled([{ ...kafka, topics: ["a", "b"] }]).spec.triggers[0]!.metadata.topic).toBeUndefined();
	});

	it("keeps Kafka credentials in the Secret, under the names KEDA reads", () => {
		expect(externalSecretData(kafka)).toEqual({
			sasl: "scram_sha256",
			tls: "disable",
			username: "user",
			password: "hunter2",
		});
	});

	it("gives SQS without keys KEDA's own AWS identity, and no Secret", () => {
		expect(externalSecretData(sqs)).toBeNull();
		expect(buildTriggerAuthentication(sqs, null)?.spec).toEqual({
			podIdentity: { provider: "aws", identityOwner: "keda" },
		});
	});

	it("reads an outside NATS through its monitoring endpoint, with no authentication", () => {
		expect(scaled([nats]).spec.triggers[0]).toMatchObject({
			type: "nats-jetstream",
			metadata: { natsServerMonitoringEndpoint: "nats.example.com:8222", useHttps: "true" },
		});
		expect(buildTriggerAuthentication(nats, null)).toBeNull();
	});

	it("refuses a malformed trigger id", () => {
		expect(() => scaled([{ ...kafka, id: "a/b" }])).toThrow();
	});
});
