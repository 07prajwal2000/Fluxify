import { describe, expect, it } from "bun:test";
import { shouldSkipPlanner } from "./router";

describe("shouldSkipPlanner", () => {
	it("skips the planner for a simple build", () => {
		expect(shouldSkipPlanner("builder", false, true, "manual")).toBe(true);
		expect(shouldSkipPlanner("builder", false, true, "auto")).toBe(true);
		expect(shouldSkipPlanner("builder", false, true, undefined)).toBe(true);
	});

	it("keeps the planner when the request is not simple", () => {
		expect(shouldSkipPlanner("builder", false, false, "auto")).toBe(false);
	});

	// "plan" means the user asked for a plan outright. No complexity judgement
	// gets to decide they don't want one.
	it("never skips the planner in plan mode", () => {
		expect(shouldSkipPlanner("builder", false, true, "plan")).toBe(false);
	});

	it("does not apply to discussion or to a rejected build", () => {
		expect(shouldSkipPlanner("discussion", false, true, "auto")).toBe(false);
		expect(shouldSkipPlanner("builder", true, true, "auto")).toBe(false);
	});
});
