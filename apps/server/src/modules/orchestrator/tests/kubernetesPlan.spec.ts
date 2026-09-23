import { describe, expect, it } from "bun:test";
import { LABELS, MANAGED_BY, MANAGED_LABEL } from "../containerSpec";
import type { KubeObject } from "../drivers/kubernetesApi";
import { objectHash, planKubernetes, podsToNodes } from "../kubernetesPlan";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";

const object = (kind: KubeObject["kind"], name: string, over: Partial<KubeObject["metadata"]> = {}) =>
	({
		apiVersion: "v1",
		kind,
		metadata: { name, labels: { [MANAGED_LABEL]: MANAGED_BY, [LABELS.claim]: CLAIM }, ...over },
	}) as KubeObject;

describe("planKubernetes", () => {
	const service = object("Service", "svc");

	it("applies what is missing, changed, or edited by someone else", () => {
		const found = { ...service, metadata: { ...service.metadata, generation: 2 } };
		const plan = (applied: Map<string, { hash: string; generation?: number }>, observed = [found]) =>
			planKubernetes({ wanted: [service], observed, applied, keep: new Set() }).apply.length;

		expect(plan(new Map(), [])).toBe(1);
		expect(plan(new Map([["Service/svc", { hash: objectHash(service), generation: 2 }]]))).toBe(0);
		expect(plan(new Map([["Service/svc", { hash: "old", generation: 2 }]]))).toBe(1);
		expect(plan(new Map([["Service/svc", { hash: objectHash(service), generation: 1 }]]))).toBe(1);
	});

	it("removes an unwanted claim's objects autoscaler first, and never an unlabelled one", () => {
		const observed = [
			object("Deployment", "d"),
			object("ScaledObject", "s"),
			object("Secret", "shared", { labels: { [MANAGED_LABEL]: MANAGED_BY } }),
		];
		const plan = planKubernetes({ wanted: [], observed, applied: new Map(), keep: new Set() });
		expect(plan.remove.map((o) => o.kind)).toEqual(["ScaledObject", "Deployment"]);

		const kept = planKubernetes({ wanted: [], observed, applied: new Map(), keep: new Set([CLAIM]) });
		expect(kept.remove).toEqual([]);
	});

	it("removes a deleted trigger's credentials, after the autoscaler that reads them", () => {
		const trigger = { labels: { [MANAGED_LABEL]: MANAGED_BY, "fluxify.trigger-id": "t1" } };
		const secret = object("Secret", "fluxify-trigger-t1", trigger);
		const auth = object("TriggerAuthentication", "fluxify-trigger-t1", trigger);
		const observed = [secret, auth, object("ScaledObject", "s")];

		const gone = planKubernetes({ wanted: [], observed, applied: new Map(), keep: new Set() });
		expect(gone.remove.map((o) => o.kind)).toEqual(["ScaledObject", "TriggerAuthentication", "Secret"]);

		const wanted = planKubernetes({ wanted: [secret, auth], observed, applied: new Map(), keep: new Set() });
		expect(wanted.remove.map((o) => o.kind)).toEqual(["ScaledObject"]);
	});
});

describe("podsToNodes", () => {
	const pod = (name: string, status: unknown, over: Partial<KubeObject["metadata"]> = {}) =>
		({ ...object("Pod", name, over), spec: { containers: [{ image: "w:1" }] }, status }) as KubeObject;
	const waiting = (reason: string) => ({ containerStatuses: [{ state: { waiting: { reason } } }] });

	it("names a node by its pod and numbers pods by name within their claim", () => {
		const nodes = podsToNodes([
			pod("w-b", { containerStatuses: [{ state: { running: {} } }] }),
			pod("w-a", waiting("ImagePullBackOff")),
			pod("w-c", { phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable" }] }),
			pod("w-d", {}, { deletionTimestamp: "2026-09-22T00:00:00Z" }),
		]);

		expect(nodes.map((n) => [n.nodeId, n.replicaIndex, n.platformState, n.running])).toEqual([
			["w-a", 0, "ImagePullBackOff", false],
			["w-b", 1, "running", true],
			["w-c", 2, "Unschedulable", false],
			["w-d", 3, "terminating", false],
		]);
		expect(nodes[0]).toMatchObject({ claimId: CLAIM, containerId: "w-a", image: "w:1", projectId: null });
	});
});
