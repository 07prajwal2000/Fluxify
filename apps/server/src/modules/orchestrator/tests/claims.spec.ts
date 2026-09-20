import { describe, expect, it } from "bun:test";
import { instancePatchRefusal } from "../claims";

/**
 * Which surface may write what (#423). The operator sizes and releases any
 * claim; a project's own vocabulary — what it runs and which of its trigger
 * groups it serves — is only editable in that project.
 */
describe("what the instance surface may patch", () => {
	const instance = { instance: true };

	it("refuses a project claim's trigger groups", () => {
		expect(instancePatchRefusal("proj-a", { groupIds: ["grp-1"] }, instance)).toContain(
			"that project's settings",
		);
	});

	it("refuses a project claim's type", () => {
		expect(instancePatchRefusal("proj-a", { type: "both" }, instance)).not.toBeNull();
	});

	it("allows a project claim to be resized", () => {
		expect(instancePatchRefusal("proj-a", { replicas: 3 }, instance)).toBeNull();
	});

	it("allows a catch-all claim to be changed in full", () => {
		expect(instancePatchRefusal(null, { type: "both", groupIds: [] }, instance)).toBeNull();
	});

	it("leaves the project surface alone", () => {
		// A project editing its own claim is the whole point of that page.
		expect(instancePatchRefusal("proj-a", { groupIds: ["grp-1"] }, {})).toBeNull();
	});
});
