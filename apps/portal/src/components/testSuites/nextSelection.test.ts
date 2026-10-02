import { describe, expect, it } from "bun:test";
import { selectionAfterDelete } from "./nextSelection";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("selectionAfterDelete", () => {
	it("opens the suite that took the deleted one's place", () => {
		expect(selectionAfterDelete(list, "b", "b")).toBe("c");
	});

	it("falls back to the previous suite when the last one is deleted", () => {
		expect(selectionAfterDelete(list, "c", "c")).toBe("b");
	});

	it("returns null when the only suite is deleted", () => {
		expect(selectionAfterDelete([{ id: "a" }], "a", "a")).toBeNull();
	});

	it("keeps the open suite when another one is deleted", () => {
		expect(selectionAfterDelete(list, "a", "c")).toBe("c");
		expect(selectionAfterDelete(list, "a", null)).toBeNull();
	});
});
