import { DEFAULT_RESOURCES } from "../claimMetadata";
import { describe, expect, it } from "bun:test";
import type { NodeAssignment } from "@fluxify/common/orchestrator";
import type { Assignments } from "../assignments";
import type { DesiredNode } from "../projection";
import { publishAssignments } from "../reconciler";

/**
 * One record per claim, not per replica (#426).
 *
 * The two rules worth a test are the ones a reader would not notice breaking:
 * a claim with three replicas must be written once, and a prune must not take
 * the record of a claim that still exists but cannot be placed — its
 * containers are still running and reading it.
 */

const CLAIM_A = "0199a1b2-c3d4-7e5f-8a9b-000000000001";
const CLAIM_B = "0199a1b2-c3d4-7e5f-8a9b-000000000002";

function node(claimId: string, replicaIndex: number, placeable = true): DesiredNode {
	return {
		claimId,
		replicaIndex,
		projectId: null,
		type: "both",
		groupIds: [],
		excludedGroups: [],
		resources: DEFAULT_RESOURCES,
		placeable,
		reason: placeable ? null : "no_license_slot",
	};
}

function fakeAssignments() {
	const writes: { claimId: string; assignment: NodeAssignment }[] = [];
	let kept: ReadonlySet<string> = new Set();
	const assignments: Assignments = {
		async write(claimId, assignment) {
			writes.push({ claimId, assignment });
		},
		async prune(keepClaimIds) {
			kept = keepClaimIds;
		},
	};
	return { assignments, writes, keptClaims: () => kept };
}

describe("publishAssignments", () => {
	it("writes one record per claim however many replicas it has", async () => {
		const { assignments, writes } = fakeAssignments();

		await publishAssignments(
			[node(CLAIM_A, 0), node(CLAIM_A, 1), node(CLAIM_A, 2), node(CLAIM_B, 0)],
			assignments,
		);

		expect(writes.map((write) => write.claimId)).toEqual([CLAIM_A, CLAIM_B]);
	});

	it("keeps the record of a claim that exists but cannot be placed", async () => {
		const { assignments, writes, keptClaims } = fakeAssignments();

		// The license stopped allowing this claim. Its containers keep serving
		// (§12), so pulling the record would have them fall back to their
		// environment on the next restart.
		await publishAssignments([node(CLAIM_A, 0, false), node(CLAIM_B, 0)], assignments);

		expect(writes.map((write) => write.claimId)).toEqual([CLAIM_B]);
		expect([...keptClaims()].sort()).toEqual([CLAIM_A, CLAIM_B]);
	});

	it("prunes everything when no claim is left", async () => {
		const { assignments, keptClaims } = fakeAssignments();

		await publishAssignments([], assignments);

		expect([...keptClaims()]).toEqual([]);
	});
});
