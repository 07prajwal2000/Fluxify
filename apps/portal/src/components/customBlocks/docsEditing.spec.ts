import { expect, test } from "bun:test";
import { insertBlock, prefixLine, wrapSelection } from "./docsEditing";

test("toolbar edits", () => {
	expect(wrapSelection("a bc d", 2, 4, "**", "**")).toEqual({ value: "a **bc** d", start: 4, end: 6 });
	expect(prefixLine("one\ntwo", 5, "## ")).toEqual({ value: "one\n## two", start: 8, end: 8 });
	expect(insertBlock("x tip y", 2, 5, ":::info\n", "\n:::").value).toBe("x \n:::info\ntip\n:::\n y");
});
