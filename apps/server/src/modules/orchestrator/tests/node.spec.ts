import { describe, expect, it } from "bun:test";
import type { NodeEntitlement, NodeHeartbeat } from "@fluxify/common/orchestrator";
import { generateNodeId, losesClaimRace, refuseSlot } from "../node";

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

function beat(nodeId: string, at: string): NodeHeartbeat {
	return {
		nodeId,
		projectId: "*",
		type: "both",
		groupIds: [],
		ready: true,
		at,
	};
}

describe("refuseSlot", () => {
	it("lets a node in while the license has room", () => {
		expect(refuseSlot({ type: "both", entitlement: COMMUNITY, liveNodes: 0 })).toBeNull();
	});

	it("refuses the node that would exceed the tier's count", () => {
		const refusal = refuseSlot({ type: "both", entitlement: COMMUNITY, liveNodes: 1 });
		expect(refusal?.reason).toBe("no_license_slot");
		// the operator has to be able to act on it, so both numbers are in the text
		expect(refusal?.message).toContain("1 worker node");
	});

	it("counts every live node, whatever type it runs", () => {
		expect(refuseSlot({ type: "route", entitlement: NON_COMMERCIAL, liveNodes: 1 })).toBeNull();
		expect(refuseSlot({ type: "route", entitlement: NON_COMMERCIAL, liveNodes: 2 })?.reason).toBe(
			"no_license_slot",
		);
	});

	it("refuses a type the license does not allow, before counting anything", () => {
		const refusal = refuseSlot({ type: "route", entitlement: COMMUNITY, liveNodes: 0 });
		expect(refusal?.reason).toBe("not_licensed");
	});

	it("never refuses on count when the license sets no limit", () => {
		expect(refuseSlot({ type: "workflow", entitlement: ENTERPRISE, liveNodes: 99 })).toBeNull();
	});
});

describe("losesClaimRace", () => {
	const mine = beat("b", "2026-09-12T10:00:01.000Z");

	it("keeps the oldest claims and drops the surplus", () => {
		const older = beat("a", "2026-09-12T10:00:00.000Z");
		expect(losesClaimRace(mine, [older, mine], 1)).toBe(true);
		expect(losesClaimRace(older, [older, mine], 1)).toBe(false);
	});

	it("keeps both when the license has room for both", () => {
		const other = beat("a", "2026-09-12T10:00:00.000Z");
		expect(losesClaimRace(mine, [other, mine], 2)).toBe(false);
	});

	it("breaks an exact tie by node id, so the two workers never both stay or both go", () => {
		const same = beat("a", mine.at);
		expect(losesClaimRace(mine, [same, mine], 1)).toBe(true);
		expect(losesClaimRace(same, [same, mine], 1)).toBe(false);
	});

	it("never drops a node on an unlimited license", () => {
		const crowd = Array.from({ length: 20 }, (_, i) => beat(`n${i}`, "2026-09-12T09:00:00.000Z"));
		expect(losesClaimRace(mine, [...crowd, mine], null)).toBe(false);
	});
});

describe("generateNodeId", () => {
	it("is short, and different each time", () => {
		const ids = new Set(Array.from({ length: 50 }, generateNodeId));
		expect([...ids].every((id) => /^[0-9a-f]{5}$/.test(id))).toBe(true);
		// a collision is handled when claiming, but it should be rare enough to notice
		expect(ids.size).toBeGreaterThan(45);
	});
});
