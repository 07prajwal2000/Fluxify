import { describe, expect, it } from "bun:test";
import { nodeIdFor } from "../containerSpec";
import { planReconcile, type ObservedNode } from "../plan";
import type { DesiredNode } from "../projection";

const CLAIM = "0192b1c4-1111-7000-8000-000000000001";
const IMAGE = "fluxify-worker-compiled:latest";

function desired(overrides: Partial<DesiredNode> = {}): DesiredNode {
	return {
		claimId: CLAIM,
		replicaIndex: 0,
		projectId: null,
		type: "both",
		groupIds: [],
		excludedGroups: [],
		placeable: true,
		reason: null,
		...overrides,
	};
}

function observed(node: DesiredNode, overrides: Partial<ObservedNode> = {}): ObservedNode {
	return {
		containerId: `container-${node.replicaIndex}`,
		nodeId: nodeIdFor(node.claimId, node.replicaIndex),
		claimId: node.claimId,
		replicaIndex: node.replicaIndex,
		projectId: node.projectId,
		image: IMAGE,
		running: true,
		platformState: "running",
		...overrides,
	};
}

const plan = (d: DesiredNode[], o: ObservedNode[]) => planReconcile(d, o, { image: IMAGE });

describe("planReconcile", () => {
	it("creates a node nothing is serving yet", () => {
		const node = desired();
		expect(plan([node], [])).toEqual([{ kind: "create", node }]);
	});

	it("leaves a node that already matches alone", () => {
		const node = desired();
		expect(plan([node], [observed(node)])).toEqual([]);
	});

	it("removes a container nobody asks for any more", () => {
		const gone = observed(desired({ replicaIndex: 3 }));
		expect(plan([], [gone])).toEqual([{ kind: "remove", container: gone, reason: "orphan" }]);
	});

	it("recreates a node whose image moved on", () => {
		const node = desired();
		const stale = observed(node, { image: "fluxify-worker-compiled:old" });
		const actions = plan([node], [stale]);
		expect(actions).toHaveLength(1);
		expect(actions[0]?.kind).toBe("recreate");
	});

	it("recreates a node whose project changed, because the project is baked in", () => {
		const node = desired({ projectId: "0192b1c4-2222-7000-8000-000000000002" });
		const actions = plan([node], [observed(node, { projectId: null })]);
		expect(actions[0]?.kind).toBe("recreate");
	});

	it("does not recreate for a type or group change — those go through the assignment", () => {
		// the worker watches its own record and applies a new group list in
		// place, which is the entire reason the seam exists
		const node = desired({ type: "workflow", groupIds: ["0192b1c4-3333-7000-8000-000000000003"] });
		expect(plan([node], [observed(node)])).toEqual([]);
	});

	it("removes a running node when the operator shrank the pool", () => {
		const node = desired({ placeable: false, reason: "pool_unavailable" });
		const container = observed(node);
		expect(plan([node], [container])).toEqual([
			{ kind: "remove", container, reason: "pool_unavailable" },
		]);
	});

	it("leaves a running node alone when the license lapsed, so traffic survives a billing hiccup", () => {
		for (const reason of ["no_license_slot", "not_licensed"] as const) {
			const node = desired({ placeable: false, reason });
			expect(plan([node], [observed(node)])).toEqual([]);
		}
	});

	it("does not start a node that cannot be placed", () => {
		expect(plan([desired({ placeable: false, reason: "no_license_slot" })], [])).toEqual([]);
	});

	it("frees slots before filling them: every removal comes before every create", () => {
		const stale = observed(desired({ replicaIndex: 9 }));
		const fresh = desired({ replicaIndex: 0 });
		const kinds = plan([fresh], [stale]).map((action) => action.kind);
		expect(kinds).toEqual(["remove", "create"]);
	});
});
