import { describe, expect, it } from "bun:test";
import { SLUG_PATTERN, toSlug } from "../slug";

describe("toSlug", () => {
	it("makes a valid slug from free text", () => {
		for (const [input, out] of [
			["My Orders API", "my-orders-api"],
			["  --Billing__v2!! ", "billing-v2"],
			["already-ok", "already-ok"],
		])
			expect(toSlug(input)).toBe(out);
		expect(SLUG_PATTERN.test(toSlug("A".repeat(49) + " b c"))).toBe(true);
	});

	it("is empty when nothing is usable", () => {
		expect(toSlug("!!! ")).toBe("");
	});
});
