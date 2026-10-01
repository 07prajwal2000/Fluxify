import { describe, expect, it } from "bun:test";
import { getVarBlockSchema } from "../getVar";
import { setVarSchema } from "../setVar";

describe("Single / Multiple mode schemas", () => {
	it("loads a saved block without a mode as Single", () => {
		expect(getVarBlockSchema.safeParse({ key: "a" }).success).toBe(true);
	});

	it("needs at least one row in Multiple mode", () => {
		expect(getVarBlockSchema.safeParse({ mode: "multiple", items: [] }).success).toBe(false);
	});

	it("rejects a variable set twice in one block, pointing at the second row", () => {
		const result = setVarSchema.safeParse({
			mode: "multiple",
			items: [
				{ key: "a", value: 1 },
				{ key: "a", value: 2 },
			],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0].path).toEqual(["items", 1, "key"]);
	});
});
