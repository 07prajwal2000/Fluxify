import { describe, expect, it } from "bun:test";
import { requiresPlanReview } from "./planner";

describe("requiresPlanReview", () => {
	it("leaves the judgement to the planner in manual mode", () => {
		// what the harness did before apply modes existed
		expect(requiresPlanReview("manual", 5, "low")).toBe(false);
		expect(requiresPlanReview("manual", 3, "low")).toBe(true);
		expect(requiresPlanReview("manual", 5, "high")).toBe(true);
	});

	it("treats a missing mode as manual", () => {
		expect(requiresPlanReview(undefined, 5, "low")).toBe(false);
		expect(requiresPlanReview(undefined, 2, "low")).toBe(true);
	});

	it("always stops in plan mode, however confident the planner is", () => {
		expect(requiresPlanReview("plan", 5, "low")).toBe(true);
	});

	it("never stops in auto mode, however unsure the planner is", () => {
		expect(requiresPlanReview("auto", 1, "high")).toBe(false);
	});
});
