import type { NodeEntitlement } from "@fluxify/common/orchestrator";
import { describe, expect, it } from "bun:test";
import { projectDesiredNodes, validateClaim, type Claim } from "../projection";

/**
 * What a claim's environment decides (#742) — projected beside the claims that
 * share its pool, and validated on the way in. Development claims are the one
 * shape the license does not govern: they hold no slot and spend no edition
 * rule, so what refuses them is the pool and nothing else.
 */

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

describe("projectDesiredNodes: environments (#742)", () => {
	it("carries the claim's environment onto every node", () => {
		const nodes = projectDesiredNodes({
			claims: [claim({ id: "dev", replicas: 2, env: "development" }), claim({ id: "prod", replicas: 1 })],
			maxNodes: 10,
			entitlement: ENTERPRISE,
		});
		expect(nodes.find((n) => n.claimId === "dev")!.env).toBe("development");
		// A claim written before the column runs production, as it always did.
		expect(nodes.find((n) => n.claimId === "prod")!.env).toBe("production");
	});

	it("leaves the groups a development claim names to the catch-all", () => {
		// Production work still has to run: a dev claim runs the same groups
		// against development artifacts, so it owns nothing in production.
		const nodes = projectDesiredNodes({
			claims: [
				claim({ id: "catch-all", projectId: null, type: "both", groupIds: [] }),
				claim({ id: "dev", projectId: "proj-a", groupIds: ["grp-1"], env: "development" }),
			],
			maxNodes: 10,
			entitlement: ENTERPRISE,
		});
		expect(nodes.find((n) => n.claimId === "catch-all")!.excludedGroups).toEqual([]);
	});

	describe("the license", () => {
		it("places a development claim beside the two production claims a non-commercial license pays for", () => {
			// The reported shape: a route and a workflow claim spend the two
			// slots, and a development claim still runs.
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "route", type: "route", groupIds: [], createdAt: new Date(1) }),
					claim({ id: "workflow", createdAt: new Date(2) }),
					claim({
						id: "dev",
						type: "route",
						groupIds: [],
						replicas: 2,
						env: "development",
						createdAt: new Date(3),
					}),
				],
				maxNodes: 10,
				entitlement: NON_COMMERCIAL,
			});
			expect(nodes.filter((n) => n.env === "production").map((n) => n.reason)).toEqual([null, null]);
			expect(nodes.filter((n) => n.claimId === "dev").map((n) => n.reason)).toEqual([null, null]);
		});

		it("places a development claim whose project and type community leaves out of production", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({
						id: "dev",
						projectId: "proj-a",
						type: "route",
						groupIds: [],
						env: "development",
					}),
				],
				maxNodes: 10,
				entitlement: COMMUNITY,
			});
			expect(nodes).toHaveLength(1);
			expect(nodes[0]).toMatchObject({ placeable: true, reason: null });
			// The same claim in production is refused for both reasons at once.
			expect(
				projectDesiredNodes({
					claims: [claim({ projectId: "proj-a", type: "route", groupIds: [] })],
					maxNodes: 10,
					entitlement: COMMUNITY,
				})[0],
			).toMatchObject({ placeable: false, reason: "not_licensed" });
		});

		it("fits a development claim beside the one node community licenses", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({
						id: "dev",
						projectId: null,
						type: "both",
						groupIds: [],
						env: "development",
						createdAt: new Date(1),
					}),
					claim({ id: "prod", projectId: null, type: "both", groupIds: [], createdAt: new Date(2) }),
				],
				maxNodes: 10,
				entitlement: COMMUNITY,
			});
			expect(nodes.map((n) => [n.claimId, n.reason])).toEqual([
				["dev", null],
				["prod", null],
			]);
		});

		it("is refused by the pool alone when nothing is left, never for a slot it does not take", () => {
			const nodes = projectDesiredNodes({
				claims: [
					claim({ id: "prod", projectId: null, type: "both", groupIds: [], createdAt: new Date(1) }),
					claim({ id: "dev", replicas: 2, env: "development", createdAt: new Date(2) }),
				],
				maxNodes: 2,
				entitlement: COMMUNITY,
			});
			expect(nodes.map((n) => [n.claimId, n.reason])).toEqual([
				["prod", null],
				["dev", null],
				["dev", "pool_unavailable"],
			]);
		});

		it("leaves every production node placeable when one is added", () => {
			const production = [
				claim({ id: "route", type: "route", groupIds: [], createdAt: new Date(1) }),
				claim({ id: "workflow", createdAt: new Date(2) }),
			];
			const prodReasons = (claims: Claim[]) =>
				projectDesiredNodes({ claims, maxNodes: 10, entitlement: NON_COMMERCIAL })
					.filter((n) => n.env === "production")
					.map((n) => n.reason);

			expect(prodReasons(production)).toEqual([null, null]);
			// Older, so it is placed first and would spend a slot if it took one.
			expect(
				prodReasons([
					claim({ id: "dev", replicas: 3, env: "development", createdAt: new Date(0) }),
					...production,
				]),
			).toEqual([null, null]);
		});
	});
});

describe("validateClaim: a development claim (#742)", () => {
	const base = {
		projectId: "proj-a",
		type: "workflow" as const,
		groupIds: ["grp-1"],
		replicas: 1,
	};
	const context = { entitlement: ENTERPRISE, existingReplicas: 0, hasSubdomain: true };
	const message = (result: ReturnType<typeof validateClaim>) => (result.ok ? "" : result.message);

	it("is not refused by a license cap it does not consume", () => {
		// Community runs one node; a development claim takes no slot, so its
		// replicas are not counted against the one that is there.
		const result = validateClaim(
			{ ...base, projectId: null, type: "both", groupIds: [], replicas: 3, env: "development" },
			{ entitlement: COMMUNITY, existingReplicas: 1, hasSubdomain: false },
		);
		expect(result).toEqual({ ok: true });
	});

	it("still refuses a production claim for the same replicas", () => {
		const result = validateClaim(
			{ ...base, projectId: null, type: "both", groupIds: [], replicas: 3 },
			{ entitlement: COMMUNITY, existingReplicas: 1, hasSubdomain: false },
		);
		expect(result.ok).toBe(false);
		expect(message(result)).toContain("already claimed");
	});

	it("needs a subdomain when it serves APIs, like any other claim reached by host", () => {
		const result = validateClaim(
			{ ...base, type: "route", groupIds: [], env: "development" },
			{ ...context, hasSubdomain: false },
		);
		expect(result.ok).toBe(false);
		expect(message(result)).toContain("subdomain");
	});

	it("does not need one for a workflow claim, which the edge never routes to", () => {
		expect(validateClaim({ ...base, env: "development" }, { ...context, hasSubdomain: false })).toEqual({
			ok: true,
		});
	});

	it("needs none as a catch-all: it is reached on the development paths alone", () => {
		expect(
			validateClaim(
				{ ...base, projectId: null, type: "both", groupIds: [], env: "development" },
				{ ...context, hasSubdomain: false },
			),
		).toEqual({ ok: true });
	});

	it("accepts a project claim on community, which allows only the catch-all in production", () => {
		expect(
			validateClaim({ ...base, type: "both", env: "development" }, { ...context, entitlement: COMMUNITY }),
		).toEqual({ ok: true });
		const production = validateClaim({ ...base, type: "both" }, { ...context, entitlement: COMMUNITY });
		expect(production.ok).toBe(false);
		expect(message(production)).toContain("serve every project");
	});

	it("accepts a type community leaves out of production", () => {
		const claimOf = (env?: "development") => ({
			...base,
			projectId: null,
			type: "route" as const,
			groupIds: [],
			env,
		});
		const community = { entitlement: COMMUNITY, existingReplicas: 0, hasSubdomain: false };
		expect(validateClaim(claimOf("development"), community)).toEqual({ ok: true });
		expect(validateClaim(claimOf(), community).ok).toBe(false);
	});
});
