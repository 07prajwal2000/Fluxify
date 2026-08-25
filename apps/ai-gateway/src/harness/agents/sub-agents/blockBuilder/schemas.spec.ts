import { describe, expect, it } from "bun:test";
import { blockBuilderSchema } from "./schemas";

describe("blockBuilderSchema", () => {
	it("accepts an impossible result with only its reason", () => {
		expect(
			blockBuilderSchema.safeParse({
				status: "impossible",
				reasoning: "The requested provider is unavailable.",
			}).success,
		).toBe(true);
	});

	it("rejects a successful no-op", () => {
		expect(
			blockBuilderSchema.safeParse({
				status: "success",
				targetType: "route",
				targetId: "route-1",
				blocks: [],
				canvasChanges: [],
			}).success,
		).toBe(false);
	});
});
