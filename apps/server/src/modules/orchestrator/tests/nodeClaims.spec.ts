import { describe, expect, it } from "bun:test";
import { MANAGED_LABEL } from "../containerSpec";
import type { Kind, KubeApi, KubeObject } from "../drivers/kubernetesApi";
import {
	type ClaimEdit,
	type KeyedClaim,
	type NodeClaimStatus,
	readEdit,
	syncNodeClaims,
	withKeys,
} from "../nodeClaims";
import type { Claim, DesiredNode } from "../projection";

const ID = "0192b1c4-1111-7000-8000-000000000001";

const SLUGS = new Map([["p1", "shop"]]);
const GROUPS = new Map([["g1", "orders"]]);

const claim = (over: Partial<Claim> = {}): KeyedClaim =>
	withKeys(
		{
			id: ID,
			projectId: "p1",
			type: "workflow",
			groupIds: ["g1"],
			replicas: 2,
			maxReplicas: null,
			metadata: {},
			createdAt: new Date(0),
			...over,
		},
		SLUGS,
		GROUPS,
	);

/**
 * NodeClaims in memory, as far as the sync relies on them: the generation moves
 * only with the spec, a merge patch deletes a null field and refuses a stale
 * resourceVersion, and status has its own endpoint.
 */
function fakeCluster(installed = true) {
	const store = new Map<string, KubeObject>();
	const writes: string[] = [];
	let version = 0;
	const save = (object: KubeObject, specChanged: boolean) => {
		const generation = (object.metadata.generation ?? 0) + (specChanged ? 1 : 0);
		object.metadata = { ...object.metadata, generation, resourceVersion: String(++version) };
		store.set(object.metadata.name, object);
		return structuredClone(object);
	};

	const api = {
		list: async (_kind: Kind) => (installed ? [...store.values()].map((o) => structuredClone(o)) : []),
		missing: () => (installed ? [] : ["NodeClaim"]),
		apply: async (object: KubeObject) => {
			writes.push(`create ${object.metadata.name}`);
			return save(structuredClone(object), true);
		},
		patch: async (_kind: Kind, name: string, body: { metadata: KubeObject["metadata"]; spec: object }) => {
			writes.push(`patch ${name}`);
			const current = store.get(name)!;
			if (body.metadata.resourceVersion !== current.metadata.resourceVersion)
				throw new Error("409 conflict");
			const spec: Record<string, unknown> = { ...(current.spec as object), ...body.spec };
			for (const key of Object.keys(spec)) if (spec[key] === null) delete spec[key];
			const labels = { ...current.metadata.labels, ...body.metadata.labels };
			const changed = JSON.stringify(spec) !== JSON.stringify(current.spec);
			return save({ ...current, metadata: { ...current.metadata, labels }, spec }, changed);
		},
		applyStatus: async (object: KubeObject) => {
			writes.push(`status ${object.metadata.name}`);
			const current = store.get(object.metadata.name)!;
			current.status = structuredClone(object.status);
			return structuredClone(current);
		},
		remove: async (_kind: Kind, name: string) => {
			writes.push(`remove ${name}`);
			store.delete(name);
		},
	} as unknown as KubeApi;

	/** A `kubectl edit` or a GitOps sync. */
	const edit = (change: Record<string, unknown>) => {
		const object = store.get(ID)!;
		object.spec = { ...(object.spec as object), ...change };
		object.metadata.generation = (object.metadata.generation ?? 0) + 1;
		object.metadata.resourceVersion = String(++version);
	};
	const status = () => store.get(ID)?.status as NodeClaimStatus;
	return { api, store, writes, edit, status };
}

const node = (over: Partial<DesiredNode> = {}): DesiredNode => ({
	claimId: ID,
	replicaIndex: 0,
	projectId: "p1",
	type: "workflow",
	groupIds: ["g1"],
	excludedGroups: [],
	resources: { cpu: 1, memoryMb: 1024 },
	placeable: true,
	reason: null,
	...over,
});

/** Admin, answering every edit the same way, and remembering what it was asked. */
function admin(answer: { ok: true } | { ok: false; message: string } | null = { ok: true }) {
	const asked: ClaimEdit[] = [];
	const forward = async (_claimId: string, edit: ClaimEdit) => {
		asked.push(edit);
		return answer;
	};
	return { asked, forward };
}

describe("syncNodeClaims", () => {
	it("creates one resource per claim, named after it, with what the portal would show", async () => {
		const cluster = fakeCluster();
		const nodes = [node(), node({ replicaIndex: 1, placeable: false, reason: "pool_unavailable" })];
		await syncNodeClaims(cluster.api, [claim()], nodes, [], admin().forward);

		const object = cluster.store.get(ID)!;
		expect(object.metadata.labels?.[MANAGED_LABEL]).toBe("orchestrator");
		expect(object.spec).toEqual({
			project: "shop",
			type: "workflow",
			groups: ["shop/orders"],
			replicas: 2,
			resources: { cpu: 1, memoryMb: 1024 },
		});
		expect(cluster.status()).toMatchObject({
			observedGeneration: 1,
			placed: 1,
			pending: 1,
			reason: "pool_unavailable",
			conditions: [{ type: "Accepted", status: "True", reason: "InSync" }],
		});
	});

	it("writes nothing on a pass where nothing changed", async () => {
		const cluster = fakeCluster();
		const { forward } = admin();
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		cluster.writes.length = 0;
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		expect(cluster.writes).toEqual([]);
	});

	it("mirrors a portal change, and a cleared maximum leaves the resource", async () => {
		const cluster = fakeCluster();
		const { forward, asked } = admin();
		await syncNodeClaims(cluster.api, [claim({ maxReplicas: 5 })], [node()], [], forward);
		expect((cluster.store.get(ID)!.spec as { maxReplicas?: number }).maxReplicas).toBe(5);

		await syncNodeClaims(cluster.api, [claim({ replicas: 3 })], [node()], [], forward);
		const spec = cluster.store.get(ID)!.spec as { replicas: number; maxReplicas?: number };
		expect(spec.replicas).toBe(3);
		expect("maxReplicas" in spec).toBe(false);
		expect(cluster.status().observedGeneration).toBe(2);
		expect(asked).toEqual([]);
	});

	it("hands an edit made on the resource to admin and leaves the spec alone", async () => {
		const cluster = fakeCluster();
		const { forward, asked } = admin();
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		cluster.edit({ replicas: 4, resources: { cpu: 2, memoryMb: 1024 } });

		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		expect(asked).toEqual([{ replicas: 4, metadata: { resources: { cpu: 2, memoryMb: 1024 } } }]);
		expect((cluster.store.get(ID)!.spec as { replicas: number }).replicas).toBe(4);
		expect(cluster.status()).toMatchObject({
			observedGeneration: 2,
			conditions: [{ status: "True", reason: "Accepted" }],
		});

		// Admin wrote the row, so the next pass finds them equal and asks nothing.
		await syncNodeClaims(
			cluster.api,
			[claim({ replicas: 4, metadata: { resources: { cpu: 2, memoryMb: 1024 } } })],
			[node()],
			[],
			forward,
		);
		expect(asked).toHaveLength(1);
	});

	it("puts a refused edit back and keeps the reason until the spec changes again", async () => {
		const cluster = fakeCluster();
		const { forward, asked } = admin({ ok: false, message: "this license allows 1 node" });
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		cluster.edit({ replicas: 9 });

		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		expect((cluster.store.get(ID)!.spec as { replicas: number }).replicas).toBe(2);
		expect(cluster.status()).toMatchObject({
			observedGeneration: 3,
			conditions: [{ status: "False", reason: "Refused", message: "this license allows 1 node" }],
		});

		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		expect(asked).toHaveLength(1);
		expect(cluster.status().conditions[0]!.reason).toBe("Refused");

		await syncNodeClaims(cluster.api, [claim({ replicas: 3 })], [node()], [], forward);
		expect(cluster.status().conditions[0]!.reason).toBe("InSync");
	});

	it("refuses a read-only field without asking admin", async () => {
		const cluster = fakeCluster();
		const { forward, asked } = admin();
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		cluster.edit({ type: "both", replicas: 3 });

		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		expect(asked).toEqual([]);
		expect(cluster.store.get(ID)!.spec).toMatchObject({ type: "workflow", replicas: 2 });
		expect(cluster.status().conditions[0]).toMatchObject({
			status: "False",
			message: "type is changed in the portal, not on the NodeClaim",
		});
	});

	it("asks again next pass when admin could not be reached", async () => {
		const cluster = fakeCluster();
		const { forward, asked } = admin(null);
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		cluster.edit({ replicas: 3 });

		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		expect(asked).toHaveLength(2);
		expect((cluster.store.get(ID)!.spec as { replicas: number }).replicas).toBe(3);
		expect(cluster.status().observedGeneration).toBe(1);
		expect(cluster.status().conditions[0]).toMatchObject({ status: "Unknown", reason: "Waiting" });
	});

	it("removes its own resource once the claim is released, and flags anyone else's", async () => {
		const cluster = fakeCluster();
		const { forward } = admin();
		await syncNodeClaims(cluster.api, [claim()], [node()], [], forward);
		cluster.store.set("stray", {
			apiVersion: "fluxify.rest/v1alpha1",
			kind: "NodeClaim",
			metadata: { name: "stray", generation: 1 },
			spec: {},
		});

		await syncNodeClaims(cluster.api, [], [], [], forward);
		expect(cluster.store.has(ID)).toBe(false);
		expect(cluster.store.get("stray")!.status).toMatchObject({
			conditions: [{ status: "False", reason: "Refused" }],
		});
	});

	it("does nothing on a cluster without the CRD", async () => {
		const cluster = fakeCluster(false);
		await syncNodeClaims(cluster.api, [claim()], [node()], [], admin().forward);
		expect(cluster.writes).toEqual([]);
	});
});

describe("readEdit", () => {
	it("patches only what changed, and a removed maximum clears it", () => {
		const row = claim({ maxReplicas: 4 });
		const spec = {
			project: "shop",
			type: "workflow",
			groups: ["shop/orders"],
			replicas: 2,
			resources: { cpu: 1, memoryMb: 1024 },
		};
		expect(readEdit(spec, row)).toEqual({ edit: { maxReplicas: null } });
		expect(readEdit({ ...spec, maxReplicas: 4 }, row)).toEqual({ edit: {} });
	});

	it("reads the catch-all's project as *", () => {
		const row = claim({ projectId: null, groupIds: [] });
		expect(readEdit({ project: "shop", type: "workflow", groups: [] }, row)).toEqual({
			refusal: "project is changed in the portal, not on the NodeClaim",
		});
	});
});

describe("withKeys", () => {
	it("names the project by slug and each group as <slug>/<name>", () => {
		expect(claim().keys).toEqual({ project: "shop", groups: ["shop/orders"] });
	});

	it("drops a deleted group and keeps the catch-all as *", () => {
		expect(claim({ groupIds: ["g1", "gone"] }).keys.groups).toEqual(["shop/orders"]);
		expect(claim({ projectId: null, groupIds: [] }).keys).toEqual({ project: "*", groups: [] });
	});

	it("refuses a group changed by id instead of key", () => {
		const row = claim();
		const spec = { project: "shop", type: "workflow", groups: ["g1"], replicas: 2 };
		expect(readEdit(spec, row)).toEqual({
			refusal: "groups is changed in the portal, not on the NodeClaim",
		});
	});
});
