import { describe, expect, it } from "bun:test";
import type { NodeEntitlement } from "@fluxify/common/orchestrator";
import { desiredReplicas, scalingCeilings, scalingRefusal } from "../scaling";

const COMMUNITY: NodeEntitlement = { maxReplicas: 1, types: ["both"], perProject: false };
const ENTERPRISE: NodeEntitlement = {
	maxReplicas: null,
	types: ["route", "workflow", "both"],
	perProject: true,
};

const claim = (id: string, replicas: number, maxReplicas: number | null, ageMs = 0) => ({
	id,
	replicas,
	maxReplicas,
	createdAt: new Date(1_000_000 + ageMs),
});

describe("desiredReplicas", () => {
	const at = (pending: number) => desiredReplicas({ pending, threshold: 10, min: 2, max: 6 });

	it("asks for one node per threshold of queued messages", () => {
		expect(at(30)).toBe(3);
		expect(at(31)).toBe(4);
	});

	it("never goes below the floor", () => {
		expect(at(0)).toBe(2);
		expect(at(-5)).toBe(2);
	});

	it("never goes above the ceiling", () => {
		expect(at(10_000)).toBe(6);
	});

	it("keeps the floor when the ceiling is below it", () => {
		expect(desiredReplicas({ pending: 100, threshold: 10, min: 3, max: 1 })).toBe(3);
	});
});

describe("scalingCeilings", () => {
	it("gives the room above every floor to the oldest claim first", () => {
		// Pool 10, floors 2 + 2: six spare, and together they must not exceed it.
		const ceilings = scalingCeilings(
			[claim("newer", 2, 10, 5), claim("older", 2, 10, 0)],
			10,
			ENTERPRISE,
		);
		expect(ceilings.get("older")).toBe(8);
		expect(ceilings.get("newer")).toBe(2);
	});

	it("never raises a claim past the maximum it asked for", () => {
		const ceilings = scalingCeilings([claim("a", 1, 3, 0), claim("b", 1, 10, 5)], 10, ENTERPRISE);
		expect(ceilings.get("a")).toBe(3);
		expect(ceilings.get("b")).toBe(7);
	});

	it("runs a claim with no maximum at its floor", () => {
		expect(scalingCeilings([claim("a", 2, null)], 10, ENTERPRISE).get("a")).toBe(2);
	});

	it("grows nothing when the floors already fill the pool", () => {
		expect(scalingCeilings([claim("a", 4, 10)], 3, ENTERPRISE).get("a")).toBe(4);
	});

	it("grows nothing on a license that caps the node count", () => {
		expect(scalingCeilings([claim("a", 1, 5)], 10, COMMUNITY).get("a")).toBe(1);
	});
});

describe("scalingRefusal", () => {
	it("accepts no maximum at all", () => {
		expect(scalingRefusal({ replicas: 2, maxReplicas: null }, COMMUNITY)).toBeNull();
	});

	it("refuses a maximum below the replica count", () => {
		expect(scalingRefusal({ replicas: 3, maxReplicas: 2 }, ENTERPRISE)).toContain("below");
	});

	it("refuses growth on a license that caps the node count", () => {
		expect(scalingRefusal({ replicas: 1, maxReplicas: 2 }, COMMUNITY)).toContain("fixed number");
	});

	it("accepts a maximum equal to the replica count on any license", () => {
		expect(scalingRefusal({ replicas: 1, maxReplicas: 1 }, COMMUNITY)).toBeNull();
	});
});
