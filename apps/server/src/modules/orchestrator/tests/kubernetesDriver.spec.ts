import { describe, expect, it } from "bun:test";
import { orchestrationScalingSchema } from "../../../lib/instance-settings/schemas";
import { DEFAULT_RESOURCES } from "../claimMetadata";
import { createKubernetesDriver } from "../drivers/kubernetes";
import { FIELD_MANAGER, type Kind, type KubeApi, type KubeObject } from "../drivers/kubernetesApi";
import { REPLICAS_MANAGER } from "../kubernetesSpec";
import type { DesiredNode } from "../projection";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";
const NAME = `fluxify-worker-${CLAIM}`;

/**
 * An API server in memory: server-side apply as far as this driver relies on
 * it — the generation moves only when the spec does, and the Deployment's own
 * apply never owns the replica count.
 */
function fakeCluster(missing: Kind[] = []) {
	const store = new Map<string, KubeObject>();
	const calls: string[] = [];
	const key = (kind: string, name: string) => `${kind}/${name}`;
	const spec = (object?: KubeObject) => (object?.spec ?? {}) as Record<string, unknown>;

	const api = {
		endpoint: { base: "https://k8s.test", namespace: "fluxify", token: () => "t" },
		reachable: async () => true,
		list: async (kind: Kind) => [...store.values()].filter((object) => object.kind === kind),
		apply: async (object: KubeObject, manager = FIELD_MANAGER) => {
			calls.push(`apply ${key(object.kind, object.metadata.name)}${manager === REPLICAS_MANAGER ? " replicas" : ""}`);
			if (missing.includes(object.kind)) return null;
			const existing = store.get(key(object.kind, object.metadata.name));
			const next = structuredClone(object);
			if (manager === REPLICAS_MANAGER) {
				next.metadata = existing!.metadata;
				next.spec = { ...spec(existing), ...spec(object) };
			} else if (object.kind === "Deployment" && spec(existing).replicas !== undefined) {
				next.spec = { ...spec(object), replicas: spec(existing).replicas };
			}
			const generation = existing?.metadata.generation ?? 0;
			const changed = JSON.stringify(spec(existing)) !== JSON.stringify(spec(next));
			next.metadata = { ...next.metadata, generation: changed ? generation + 1 : generation };
			store.set(key(object.kind, object.metadata.name), next);
			return structuredClone(next);
		},
		remove: async (kind: Kind, name: string) => {
			calls.push(`remove ${key(kind, name)}`);
			store.delete(key(kind, name));
		},
	} as unknown as KubeApi;

	/** Someone else's write: a `kubectl edit`, or the HPA resizing. */
	const edit = (kind: Kind, change: Record<string, unknown>) => {
		const object = store.get(key(kind, NAME))!;
		object.spec = { ...spec(object), ...change };
		object.metadata.generation = (object.metadata.generation ?? 0) + 1;
	};
	return { api, store, calls, edit };
}

const node = (over: Partial<DesiredNode> = {}): DesiredNode => ({
	claimId: CLAIM,
	replicaIndex: 0,
	projectId: null,
	type: "both",
	groupIds: [],
	excludedGroups: [],
	resources: DEFAULT_RESOURCES,
	placeable: true,
	reason: null,
	...over,
});

const ctx = (ceiling = 1) => ({
	pool: { maxNodes: 10 },
	scaling: {
		policy: orchestrationScalingSchema.parse({}),
		ceilings: new Map([[CLAIM, ceiling]]),
		triggersByGroup: new Map(),
		externalByGroup: new Map(),
		licenseCapped: true,
	},
});

const options = {
	image: "fluxify-worker:1",
	trafficPort: 5600,
	healthPort: 5601,
	drainTimeoutSec: 35,
	scaleCpuPercent: 65,
	scaleMemoryPercent: 65,
	passthroughEnv: { NATS_URL: "nats://nats:4222" },
};

describe("createKubernetesDriver", () => {
	it("turns a claim into a Deployment, a Service, an IngressRoute and a ScaledObject", async () => {
		const { api, store } = fakeCluster();
		const driver = createKubernetesDriver(options, api);
		const events = await driver.apply([node()], [], ctx());

		expect([...store.keys()].sort()).toEqual(
			[
				`Deployment/${NAME}`,
				`IngressRoute/${NAME}`,
				`ScaledObject/${NAME}`,
				"Secret/fluxify-worker-env",
				`Service/${NAME}`,
			].sort(),
		);
		expect(events).toMatchObject([{ claimId: CLAIM, action: "created" }]);
	});

	it("sends nothing on a pass where nothing changed", async () => {
		const { api, calls } = fakeCluster();
		const driver = createKubernetesDriver(options, api);
		await driver.apply([node()], [], ctx());
		calls.length = 0;

		expect(await driver.apply([node()], [], ctx())).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("scales by patching the ScaledObject, never recreating anything", async () => {
		const { api, calls, store } = fakeCluster();
		const driver = createKubernetesDriver(options, api);
		await driver.apply([node()], [], ctx());
		calls.length = 0;

		const events = await driver.apply([node(), node({ replicaIndex: 1 })], [], ctx(4));
		expect(calls).toEqual([`apply ScaledObject/${NAME}`]);
		expect(store.get(`ScaledObject/${NAME}`)?.spec).toMatchObject({
			minReplicaCount: 2,
			maxReplicaCount: 4,
		});
		expect(events).toMatchObject([{ action: "scaled" }]);
	});

	it("puts a hand edit back, and lets the autoscaler resize without a word", async () => {
		const { api, store, edit } = fakeCluster();
		const driver = createKubernetesDriver(options, api);
		await driver.apply([node()], [], ctx());

		edit("Deployment", { replicas: 3 });
		expect(await driver.apply([node()], [], ctx())).toEqual([]);

		edit("Deployment", { template: "kubectl edit" });
		const events = await driver.apply([node()], [], ctx());
		expect(events).toMatchObject([{ action: "restored" }]);
		expect(store.get(`Deployment/${NAME}`)?.spec).not.toMatchObject({ template: "kubectl edit" });
	});

	it("removes every object of a deleted claim, and only those", async () => {
		const { api, store } = fakeCluster();
		const driver = createKubernetesDriver(options, api);
		await driver.apply([node()], [], ctx());

		const events = await driver.apply([], [], ctx());
		expect([...store.keys()]).toEqual(["Secret/fluxify-worker-env"]);
		expect(events).toMatchObject([{ claimId: CLAIM, action: "removed", reason: "draining" }]);
	});

	it("keeps a claim running when the license, not the pool, stopped it", async () => {
		const { api, store } = fakeCluster();
		const driver = createKubernetesDriver(options, api);
		await driver.apply([node()], [], ctx());

		const lapsed = node({ placeable: false, reason: "no_license_slot" });
		expect(await driver.apply([lapsed], [], ctx())).toEqual([]);
		expect(store.has(`Deployment/${NAME}`)).toBe(true);

		const shrunk = node({ placeable: false, reason: "pool_unavailable" });
		await driver.apply([shrunk], [], ctx());
		expect(store.has(`Deployment/${NAME}`)).toBe(false);
	});

	it("sets the replica count itself on a cluster without KEDA", async () => {
		const { api, store, calls } = fakeCluster(["ScaledObject"]);
		const driver = createKubernetesDriver(options, api);
		await driver.apply([node(), node({ replicaIndex: 1 })], [], ctx(2));

		expect(calls).toContain(`apply Deployment/${NAME} replicas`);
		expect(store.get(`Deployment/${NAME}`)?.spec).toMatchObject({ replicas: 2 });
		calls.length = 0;

		// The missing kind is not retried, and a settled count is not rewritten.
		expect(await driver.apply([node(), node({ replicaIndex: 1 })], [], ctx(2))).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("describes itself for the lease", () => {
		const driver = createKubernetesDriver(options, fakeCluster().api);
		expect(driver.provider).toBe("kubernetes");
		expect(driver.meta).toEqual({
			endpoint: "https://k8s.test",
			namespace: "fluxify",
			workerImage: "fluxify-worker:1",
		});
	});
});
