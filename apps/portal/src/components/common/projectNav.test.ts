import { expect, test } from "bun:test";
import { visibleNav } from "./projectNav";

const keys = (canEdit: boolean) =>
	visibleNav(canEdit).map((item) => item.key as string);

test("a creator sees the Sandboxes entry", () => {
	expect(keys(true)).toContain("sandboxes");
});

test("a viewer does not, and keeps everything else", () => {
	expect(keys(false)).not.toContain("sandboxes");
	expect(keys(false)).toEqual(keys(true).filter((key) => key !== "sandboxes"));
});
