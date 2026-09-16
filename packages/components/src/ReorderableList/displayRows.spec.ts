import { describe, expect, it } from "bun:test";
import { displayRows } from "./displayRows";

const items = ["a", "b", "c", "DEFAULT"];
const pinned = (item: string) => item === "DEFAULT";
const shape = (from: number, over: number) =>
	displayRows(items, { from, over }, pinned).map((r) =>
		r.type === "placeholder" ? `_${r.hitIndex}` : `${r.item}${r.hitIndex}${r.isDropTarget ? "*" : ""}${r.isPinnedSource ? "~" : ""}`,
	);

describe("displayRows", () => {
	it("renders items as-is when nothing is dragged", () => {
		expect(displayRows(items, null, pinned).map((r) => r.type === "item" && r.hitIndex)).toEqual([0, 1, 2, 3]);
	});

	it("slides a placeholder into the drop position", () => {
		expect(shape(0, 2)).toEqual(["b0", "c1", "_2", "DEFAULT3"]);
	});

	it("lights up a pinned row instead of sliding it", () => {
		expect(shape(0, 3)).toEqual(["b0", "c1", "DEFAULT3*"]);
	});

	it("keeps a dragged pinned row in place and cancels drops on it", () => {
		expect(shape(3, 1)).toEqual(["a0", "_1", "b2", "c3", "DEFAULT-1~"]);
		expect(shape(3, 3)).toEqual(["a0", "b1", "c2", "_3", "DEFAULT-1~"]);
	});
});
