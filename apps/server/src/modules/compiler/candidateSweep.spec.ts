import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as natsKv from "../../db/natsKv";
import { sweepCandidates } from "./candidateSweep";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (ms: number) => ({ compiledAt: new Date(NOW - ms).toISOString() });

function bucket(entries: Record<string, unknown>) {
	const deleted: string[] = [];
	spyOn(natsKv, "artifactStore").mockResolvedValue({
		keys: async () => Object.keys(entries),
		get: async (key: string) => entries[key] ?? null,
		delete: async (key: string) => void deleted.push(key),
	} as never);
	return deleted;
}

afterEach(() => spyOn(natsKv, "artifactStore").mockRestore());

describe("sweeping leftover candidate artifacts", () => {
	it("deletes a candidate over an hour old, and keeps a fresh one", async () => {
		const deleted = bucket({
			"candidate.route.p.v1-aaaa": ago(2 * 60 * 60_000),
			"candidate.route.p.v2-bbbb": ago(5_000),
		});
		expect(await sweepCandidates(NOW)).toBe(1);
		expect(deleted).toEqual(["candidate.route.p.v1-aaaa"]);
	});

	it("deletes a candidate with no readable time", async () => {
		const deleted = bucket({ "candidate.workflow.p.v3-cccc": {} });
		await sweepCandidates(NOW);
		expect(deleted).toEqual(["candidate.workflow.p.v3-cccc"]);
	});
});
