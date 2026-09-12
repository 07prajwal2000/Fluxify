import { describe, expect, it } from "bun:test";
import { groupPair } from "@fluxify/common/orchestrator";
import { runsHere } from "../types";

const internal = { projectId: "p1", groupId: "g1", type: "internal" };
const kafka = { projectId: "p1", groupId: "g1", type: "kafka" };

describe("where a trigger runs", () => {
	it("runs every group on an unpinned worker", () => {
		expect(runsHere(internal, undefined, false)).toBe(true);
		expect(runsHere(internal, [], false)).toBe(true);
	});

	it("runs only its own groups on a pinned worker", () => {
		expect(runsHere(internal, ["g1"], false)).toBe(true);
		expect(runsHere(internal, ["g2"], false)).toBe(false);
	});

	it("runs any of several groups, since one claim can name more than one", () => {
		expect(runsHere(internal, ["g0", "g1", "g2"], false)).toBe(true);
		expect(runsHere(internal, ["g0", "g2"], false)).toBe(false);
	});

	it("skips a group a dedicated node already owns", () => {
		const excluded = new Set([groupPair("p1", "g1")]);
		expect(runsHere(internal, undefined, false, excluded)).toBe(false);
		expect(runsHere({ ...internal, groupId: "g2" }, undefined, false, excluded)).toBe(true);
	});

	it("excludes by project as well as group, so two projects may reuse a group id", () => {
		const excluded = new Set([groupPair("p2", "g1")]);
		expect(runsHere(internal, undefined, false, excluded)).toBe(true);
	});

	it("runs an enterprise connector only while the license can", () => {
		expect(runsHere(kafka, undefined, true)).toBe(true);
		expect(runsHere(kafka, undefined, false)).toBe(false);
		expect(runsHere(kafka, ["g2"], true)).toBe(false);
	});
});
