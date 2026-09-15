import { expect, test } from "bun:test";
import type { SystemLog } from "@/services/systemLogs";
import { compileDiagnostics } from "./compileDiagnostics";

const blocks = [
	{ id: "b-1111", type: "entrypoint" },
	{ id: "b-2222", type: "myBlock" },
];

const log = (message: string, status: string, level: SystemLog["level"] = "error"): SystemLog => ({
	id: 1,
	projectId: "p",
	resourceType: "route",
	resourceId: "r",
	type: "compile",
	level,
	message,
	detail: { status },
	updatedAt: "2026-01-01T00:00:00Z",
});

test("no log gives nothing, a clean compile is a canvas-wide note", () => {
	expect(compileDiagnostics(undefined, blocks)).toEqual([]);
	const [diag] = compileDiagnostics(log("Compiled", "compiled", "info"), blocks);
	expect(diag.severity).toBe("info");
	expect(diag.blockId).toBeUndefined();
});

test("inactive is a canvas-wide info note", () => {
	const [diag] = compileDiagnostics(log("not deployed", "inactive", "info"), blocks);
	expect(diag.severity).toBe("info");
	expect(diag.blockId).toBeUndefined();
});

test("failure naming a block id or type lands on that block", () => {
	expect(compileDiagnostics(log("Cycle through block b-1111", "failed"), blocks)[0].blockId).toBe("b-1111");
	expect(compileDiagnostics(log("No codegen for block type: myBlock", "failed"), blocks)[0].blockId).toBe("b-2222");
});

test("failure naming no block is canvas-wide", () => {
	const diags = compileDiagnostics(log("Graph has no entrypoint block", "failed"), blocks);
	expect(diags).toHaveLength(1);
	expect(diags[0].severity).toBe("error");
	expect(diags[0].blockId).toBeUndefined();
});
