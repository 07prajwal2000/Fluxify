import { expect, test } from "bun:test";
import { validateCycles } from "./cycleValidator";
import { DIAGNOSTICS_TAB, GENERAL_TAB, splitTabs } from "../panel/BlockSettings";
import type { CanvasEdge } from "../types";
import type { BlockDiagnostic } from "./types";

test("validateCycles returns empty list for acyclic graph", () => {
	const edges: CanvasEdge[] = [
		{ id: "e1", from: "b1", to: "b2", fromHandle: "out", toHandle: "in" },
		{ id: "e2", from: "b2", to: "b3", fromHandle: "out", toHandle: "in" },
	];
	const diagnostics = validateCycles({ edges });
	expect(diagnostics).toHaveLength(0);
});

test("validateCycles flags participating blocks with error severity on cycle", () => {
	const edges: CanvasEdge[] = [
		{ id: "e1", from: "b1", to: "b2", fromHandle: "out", toHandle: "in" },
		{ id: "e2", from: "b2", to: "b3", fromHandle: "out", toHandle: "in" },
		{ id: "e3", from: "b3", to: "b1", fromHandle: "out", toHandle: "in" },
		{ id: "e4", from: "b3", to: "b4", fromHandle: "out", toHandle: "in" },
	];
	const diagnostics = validateCycles({ edges });
	const blockIds = diagnostics.map((d) => d.blockId).sort();

	expect(blockIds).toEqual(["b1", "b2", "b3"]);
	expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
	expect(diagnostics.every((d) => d.source === "cycle-detection")).toBe(true);
});

test("DIAGNOSTICS_TAB constant is defined and distinct from GENERAL_TAB", () => {
	expect(DIAGNOSTICS_TAB).toBe("Diagnostics");
	expect(DIAGNOSTICS_TAB).not.toBe(GENERAL_TAB);
});

test("splitTabs correctly separates generalExtras and blockTabs", () => {
	const { generalExtras, blockTabs } = splitTabs([]);
	expect(generalExtras).toHaveLength(0);
	expect(blockTabs).toHaveLength(0);
});
