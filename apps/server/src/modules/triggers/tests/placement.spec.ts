import { describe, expect, it } from "bun:test";
import { runsHere } from "../types";

const internal = { groupId: "g1", type: "internal" };
const kafka = { groupId: "g1", type: "kafka" };

describe("where a trigger runs", () => {
	it("runs every group on an unpinned worker", () => {
		expect(runsHere(internal, undefined, false)).toBe(true);
	});

	it("runs only its own group on a pinned worker", () => {
		expect(runsHere(internal, "g1", false)).toBe(true);
		expect(runsHere(internal, "g2", false)).toBe(false);
	});

	it("runs an enterprise connector only while the license can", () => {
		expect(runsHere(kafka, undefined, true)).toBe(true);
		expect(runsHere(kafka, undefined, false)).toBe(false);
		expect(runsHere(kafka, "g2", true)).toBe(false);
	});
});
