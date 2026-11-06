import { describe, expect, it } from "bun:test";
import { DEFAULT_RESOURCES } from "../claimMetadata";
import { LABELS, MANAGED_LABEL } from "../containerSpec";
import {
	buildScaledObject,
	buildService,
	buildTriggerAuthentication,
	buildTriggerSecret,
	type ClaimWorkload,
	type ExternalTrigger,
	externalSecretData,
	type KubernetesSpecOptions,
	triggerSecretName,
} from "../kubernetesSpec";
import { mergeByGroup } from "../pluginLagTriggers";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";
const PROJECT = "0192b1c4-2222-7000-8000-000000000002";
const LAG_A = "0192b1c4-6666-7000-8000-000000000006";
const LAG_B = "0192b1c4-7777-7000-8000-000000000007";
const TOKEN = "a".repeat(64);

const options: KubernetesSpecOptions = {
	image: "fluxify-worker-compiled:latest",
	trafficPort: 5600,
	healthPort: 5601,
	drainTimeoutSec: 35,
	scaleCpuPercent: 65,
	scaleMemoryPercent: 70,
	natsMonitoringEndpoint: "nats.fluxify.svc:8222",
	namespace: "fluxify",
};
const policy = { queuedPerNode: 10, pollIntervalSec: 30, scaleDownWindowSec: 300 };

const lag = (id: string, lagPerWorker: number): ExternalTrigger => ({
	id,
	type: "plugin-lag",
	lagPerWorker,
	token: TOKEN,
});
const workload = (over: Partial<ClaimWorkload> = {}): ClaimWorkload => ({
	claimId: CLAIM,
	projectId: PROJECT,
	type: "workflow",
	groupIds: [],
	host: null,
	env: "production",
	resources: DEFAULT_RESOURCES,
	min: 2,
	max: 6,
	triggerIds: [],
	externalTriggers: [lag(LAG_A, 50)],
	...over,
});
// biome-ignore lint/suspicious/noExplicitAny: reading into a manifest
const spec = (object: { [key: string]: unknown } | null) => (object as any).spec;

describe("a plugin trigger's lag as a KEDA scaler (#963)", () => {
	it("reads the number from the claim's workers, on their health port, as a bearer", () => {
		const { triggers } = spec(buildScaledObject(workload(), options, policy));
		expect(triggers).toEqual([
			{
				type: "metrics-api",
				metricType: "AverageValue",
				metadata: {
					url: `http://fluxify-worker-${CLAIM}.fluxify.svc:5601/_/admin/api/triggers/${LAG_A}/lag`,
					valueLocation: "lag",
					targetValue: "50",
					authMode: "bearer",
				},
				authenticationRef: { name: triggerSecretName(LAG_A) },
			},
		]);
	});

	it("asks each trigger for its own target, and scales on whichever wants most", () => {
		const both = workload({ externalTriggers: [lag(LAG_A, 50), lag(LAG_B, 5)] });
		const { triggers } = spec(buildScaledObject(both, options, policy));
		expect(triggers.map((t: { metadata: { targetValue: string } }) => t.metadata.targetValue)).toEqual(["50", "5"]);
	});

	it("sits next to the internal triggers' scalers instead of replacing them", () => {
		const mixed = workload({ triggerIds: ["0192b1c4-4444-7000-8000-000000000004"] });
		const { triggers } = spec(buildScaledObject(mixed, options, policy));
		expect(triggers.map((t: { type: string }) => t.type)).toEqual(["nats-jetstream", "metrics-api"]);
	});

	it("holds the claim where it is when the lag cannot be read, never at an empty queue", () => {
		const { fallback } = spec(buildScaledObject(workload(), options, policy));
		expect(fallback).toEqual({ failureThreshold: 3, replicas: 2, behavior: "currentReplicas" });
	});

	it("adds no fallback to a claim that scales on nothing of the sort", () => {
		const queue = workload({ externalTriggers: [], triggerIds: ["0192b1c4-4444-7000-8000-000000000004"] });
		expect(spec(buildScaledObject(queue, options, policy)).fallback).toBeUndefined();
	});

	it("needs the namespace KEDA reads it in, and says so rather than writing a wrong address", () => {
		expect(() => buildScaledObject(workload(), { ...options, namespace: undefined }, policy)).toThrow(
			"namespace",
		);
	});

	it("gives a development claim no ScaledObject, lag or not", () => {
		expect(buildScaledObject(workload({ env: "development" }), options, policy)).toBeNull();
	});

	it("keeps the token in the trigger's Secret and authenticates the scaler with it", () => {
		const trigger = lag(LAG_A, 50);
		const data = externalSecretData(trigger);
		expect(data).toEqual({ token: TOKEN });
		expect(buildTriggerSecret(LAG_A, data!).metadata.name).toBe(triggerSecretName(LAG_A));
		expect(spec(buildTriggerAuthentication(trigger, data))).toEqual({
			secretTargetRef: [{ parameter: "token", name: triggerSecretName(LAG_A), key: "token" }],
		});
		// nothing secret in the ScaledObject itself
		expect(JSON.stringify(buildScaledObject(workload(), options, policy))).not.toContain(TOKEN);
	});
});

describe("the Service in front of a claim that scales on lag", () => {
	it("gives a workflow claim one, with only the health port: it serves no HTTP", () => {
		expect(spec(buildService(workload(), options))).toEqual({
			selector: { [MANAGED_LABEL]: "orchestrator", [LABELS.claim]: CLAIM },
			ports: [{ name: "health", port: 5601, targetPort: "health" }],
		});
	});

	it("puts nothing in front of a workflow claim that does not scale on lag", () => {
		expect(buildService(workload({ externalTriggers: [] }), options)).toBeNull();
	});

	it("keeps the traffic port of a claim that serves HTTP, and adds the health one only for lag", () => {
		const http = workload({ type: "both", projectId: null, externalTriggers: [] });
		expect(spec(buildService(http, options)).ports).toEqual([
			{ name: "http", port: 5600, targetPort: "http" },
		]);
	});
});

describe("mergeByGroup", () => {
	it("joins two maps group by group, the first's triggers first", () => {
		const merged = mergeByGroup(
			new Map([["g1", [1]], ["g2", [2]]]),
			new Map([["g1", [3]], ["g3", [4]]]),
		);
		expect([...merged]).toEqual([["g1", [1, 3]], ["g2", [2]], ["g3", [4]]]);
	});
});
