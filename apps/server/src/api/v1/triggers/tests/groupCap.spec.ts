import { afterEach, describe, expect, it } from "bun:test";
import { groupCapRefusal, maxTriggersPerGroup } from "../groupCap";

describe("triggers per group cap", () => {
	afterEach(() => delete process.env.MAX_TRIGGERS_PER_GROUP);

	it("defaults to 5 and reads the env override", () => {
		expect(maxTriggersPerGroup()).toBe(5);
		process.env.MAX_TRIGGERS_PER_GROUP = "12";
		expect(maxTriggersPerGroup()).toBe(12);
	});

	it("lets a group fill up to the cap, then refuses", () => {
		expect(groupCapRefusal(4, 1, 5)).toBeNull();
		expect(groupCapRefusal(5, 1, 5)).toContain("Create another group");
	});

	it("counts every incoming trigger when a group's triggers move in at once", () => {
		expect(groupCapRefusal(2, 3, 5)).toBeNull();
		expect(groupCapRefusal(2, 4, 5)).not.toBeNull();
	});
});
