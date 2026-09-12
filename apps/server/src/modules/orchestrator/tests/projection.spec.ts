import type { NodeEntitlement } from "@fluxify/common/orchestrator";
import { describe, expect, it } from "bun:test";
import { groupPair, projectDesiredNodes, validateClaim, type Claim } from "../projection";

const COMMUNITY: NodeEntitlement = { maxReplicas: 1, types: ["both"], perProject: false };
const NON_COMMERCIAL: NodeEntitlement = {
	maxReplicas: 2,
	types: ["route", "workflow", "both"],
	perProject: true,
};
const ENTERPRISE: NodeEntitlement = {
	maxReplicas: null,
	types: ["route", "workflow", "both"],
	perProject: true,
};

let clock = 0;
function claim(overrides: Partial<Claim> = {}): Claim {
	return {
		id: `claim-${++clock}`,
		projectId: "proj-a",
		type: "workflow",
		groupIds: ["grp-1"],
		replicas: 1,
		createdAt: new Date(clock * 1000),
		...overrides,
	};
}

describe("projectDesiredNodes", () => {
	it("turns a claim into one node per replica, each with a stable index", () => {
		const nodes = projectDesiredNodes({
			claims: [claim({ id: "c1", replicas: 3 })],
			maxNodes: 10,
			entitlement: ENTERPRISE,
		});
		expect(nodes.map((n) => n.replicaIndex)).toEqual([0, 1, 2]);
		expect(nodes.every((n) => n.placeable && n.claimId === "c1")).toBe(true);
	});

	it("places nothing for a claim scaled to zero", () => {
		expect(
			projectDesiredNodes({
				claims: [claim({ replicas: 0 })],
				maxNodes: 10,
				entitlement: ENTERPRISE,
			}),
		).toEqual([]);
	});

	it("keeps a claim past the pool ceiling pending rather than forcing it onto the host", () => {
		const nodes = projectDesiredNodes({
			claims: [claim({ id: "c1", replicas: 3 })],
			maxNodes: 2,
			entitlement: ENTERPRISE,
		});
		expect(nodes.map((n) => [n.placeable, n.reason])).toEqual([
			[true, null],
			[true, null],
			[false, "pool_unavailable"],
		]);
	});

	it("allocates scarce capacity oldest claim first, whatever order the rows arrive in", () => {
		const older = claim({ id: "older", createdAt: new Date(1_000) });
		const newer = claim({ id: "newer", createdAt: new Date(2_000) });
		const placed = (claims: Claim[]) =>
			projectDesiredNodes({ claims, maxNodes: 1, entitlement: ENTERPRISE })
				.filter((n) => n.placeable)
				.map((n) => n.claimId);

		expect(placed([newer, older])).toEqual(["older"]);
		expect(placed([older, newer])).toEqual(["older"]);
	});

	describe("license tiers", () => {
		it("community gets one `both` node and nothing else", () => {
			const nodes = projectDesiredNodes({
				claims: [claim({ id: "c1", projectId: null, type: "both", replicas: 2 })],
				maxNodes: 10,
				entitlement: COMMUNITY,
			});
			expect(nodes.map((n) => n.reason)).toEqual([null, "no_license_slot"]);
		});

		it("community refuses a claim that names a project", () => {
			const nodes = projectDesiredNodes({
				claims: [claim({ projectId: "proj-a", type: "both" })],
				maxNodes: 10,
				entitlement: COMMUNITY,
			});
			expect(nodes[0]).toMatchObject({ placeable: false, reason: "not_licensed" });
		});

		it("community refuses a route-only node, which would leave workflows unserved", () => {
			const nodes = projectDesiredNodes({
				claims: [claim({ projectId: null, type: "route" })],
				maxNodes: 10,
				entitlement: COMMUNITY,
			});
			expect(nodes[0]).toMatchObject({ placeable: false, reason: "not_licensed" });
		});

		it("non-commercial fits one route and one workflow node, then runs out of slots", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "route", type: "route", groupIds: [], createdAt: new Date(1) }),
					claim({ id: "workflow", type: "workflow", createdAt: new Date(2) }),
					claim({ id: "third", type: "workflow", createdAt: new Date(3) }),
				],
				maxNodes: 10,
				entitlement: NON_COMMERCIAL,
			});
			expect(nodes.map((n) => [n.claimId, n.reason])).toEqual([
				["route", null],
				["workflow", null],
				["third", "no_license_slot"],
			]);
		});

		it("a license-refused claim consumes no pool capacity", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "refused", projectId: "proj-a", type: "both", createdAt: new Date(1) }),
					claim({ id: "allowed", projectId: null, type: "both", createdAt: new Date(2) }),
				],
				maxNodes: 1,
				entitlement: COMMUNITY,
			});
			expect(nodes.map((n) => [n.claimId, n.reason])).toEqual([
				["refused", "not_licensed"],
				["allowed", null],
			]);
		});
	});

	describe("the catch-all's exclusion list", () => {
		it("excludes every group a dedicated claim owns, and only those", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "catch-all", projectId: null, type: "both", groupIds: [] }),
					claim({ id: "dedicated", projectId: "proj-a", groupIds: ["grp-1", "grp-2"] }),
					claim({ id: "other", projectId: "proj-b", groupIds: ["grp-9"] }),
				],
				maxNodes: 10,
				entitlement: ENTERPRISE,
			});
			const byId = (id: string) => nodes.find((n) => n.claimId === id)!;
			expect(byId("catch-all").excludedGroups).toEqual([
				"proj-a:grp-1",
				"proj-a:grp-2",
				"proj-b:grp-9",
			]);
			// a dedicated node is told what it serves, not what it does not
			expect(byId("dedicated").excludedGroups).toEqual([]);
		});

		it("ignores a route claim, which consumes no group", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "catch-all", projectId: null, type: "both", groupIds: [] }),
					claim({ id: "routes", projectId: "proj-a", type: "route", groupIds: [] }),
				],
				maxNodes: 10,
				entitlement: ENTERPRISE,
			});
			expect(nodes.find((n) => n.claimId === "catch-all")!.excludedGroups).toEqual([]);
		});

		it("releases a group back to the catch-all once its claim is scaled to zero", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "catch-all", projectId: null, type: "both", groupIds: [] }),
					claim({ id: "released", projectId: "proj-a", groupIds: ["grp-1"], replicas: 0 }),
				],
				maxNodes: 10,
				entitlement: ENTERPRISE,
			});
			expect(nodes.find((n) => n.claimId === "catch-all")!.excludedGroups).toEqual([]);
		});
	});

	it("drops a group id left behind by a deleted group, but keeps the node", () => {
		const nodes = projectDesiredNodes({
			claims: [claim({ groupIds: ["grp-1", "grp-gone"] })],
			maxNodes: 10,
			entitlement: ENTERPRISE,
			knownGroups: new Set([groupPair("proj-a", "grp-1")]),
		});
		expect(nodes[0]).toMatchObject({ groupIds: ["grp-1"], placeable: true });
	});

	it("gives a route node no groups even when the claim carries some", () => {
		const nodes = projectDesiredNodes({
			claims: [claim({ type: "route", groupIds: ["grp-1"] })],
			maxNodes: 10,
			entitlement: ENTERPRISE,
		});
		expect(nodes[0]!.groupIds).toEqual([]);
	});
});

describe("validateClaim", () => {
	const base = {
		projectId: "proj-a",
		type: "workflow" as const,
		groupIds: ["grp-1"],
		replicas: 1,
	};
	const context = { entitlement: ENTERPRISE, existingReplicas: 0, hasSubdomain: true };
	const message = (result: ReturnType<typeof validateClaim>) =>
		result.ok ? "" : result.message;

	it("accepts a workflow claim with groups", () => {
		expect(validateClaim(base, context)).toEqual({ ok: true });
	});

	it("refuses a route claim while the project has no subdomain", () => {
		const result = validateClaim(
			{ ...base, type: "route", groupIds: [] },
			{ ...context, hasSubdomain: false },
		);
		expect(result.ok).toBe(false);
		expect(message(result)).toContain("subdomain");
	});

	it("accepts a catch-all route claim with no subdomain — it is reached on PathPrefix(/)", () => {
		// The claim a fresh instance is seeded with. Requiring a subdomain here
		// would make the API refuse the default deployment shape.
		expect(
			validateClaim(
				{ ...base, projectId: null, type: "both", groupIds: [] },
				{ ...context, hasSubdomain: false },
			),
		).toEqual({ ok: true });
	});

	it("refuses a workflow claim naming no groups", () => {
		expect(validateClaim({ ...base, groupIds: [] }, context).ok).toBe(false);
	});

	it("accepts a catch-all claim with no groups, which means every unowned group", () => {
		expect(validateClaim({ ...base, projectId: null, groupIds: [] }, context)).toEqual({
			ok: true,
		});
	});

	it("refuses a type the license does not allow", () => {
		const result = validateClaim(
			{ ...base, type: "route", groupIds: [] },
			{ ...context, entitlement: COMMUNITY },
		);
		expect(result.ok).toBe(false);
	});

	it("refuses a per-project claim on a license that only allows the catch-all", () => {
		const result = validateClaim({ ...base, type: "both" }, { ...context, entitlement: COMMUNITY });
		expect(result.ok).toBe(false);
	});

	it("refuses replicas that would exceed the license, counting what is already claimed", () => {
		const result = validateClaim(
			{ ...base, replicas: 2 },
			{ ...context, entitlement: NON_COMMERCIAL, existingReplicas: 1 },
		);
		expect(result.ok).toBe(false);
	});

	it("accepts a claim past the pool ceiling — it sits pending instead of being refused", () => {
		expect(validateClaim({ ...base, replicas: 50 }, context)).toEqual({ ok: true });
	});
});
