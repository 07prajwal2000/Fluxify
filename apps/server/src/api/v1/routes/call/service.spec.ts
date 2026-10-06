import { describe, expect, it } from "bun:test";
import { BadRequestError } from "../../../../errors/badRequestError";
import { fillPath } from "./service";

describe("fillPath", () => {
	it("fills and encodes each :param", () => {
		expect(fillPath("/users/:id/posts/:postId", { id: "a b", postId: "7" })).toBe("/users/a%20b/posts/7");
		expect(fillPath("/health")).toBe("/health");
	});

	it("refuses a missing param", () => {
		expect(() => fillPath("/users/:id", {})).toThrow(BadRequestError);
	});
});
