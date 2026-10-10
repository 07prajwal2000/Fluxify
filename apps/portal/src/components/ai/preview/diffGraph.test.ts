import { expect, test } from "bun:test";
import type { CanvasDiff } from "./canvasDiff";
import { toGraph } from "./diffGraph";

const block = (key: string, type: string) => ({
	key,
	type,
	status: "same" as const,
	data: {},
	changes: [],
});
const diff = (partial: boolean): CanvasDiff => ({
	blocks: [block("if_1", "if"), block("log_1", "consolelog"), block("log_2", "consolelog")],
	edges: [
		{ id: "a", from: "if_1", to: "log_1", handle: "success", status: "same" },
		{ id: "b", from: "if_1", to: "log_2", handle: "failure", status: "same" },
		{ id: "c", from: "log_1", to: "log_2", handle: "source", status: "same" },
	],
	partial,
});

test("each edge leaves from the handle it names, so failure does not end up on success", () => {
	for (const partial of [false, true]) {
		const edges = toGraph(diff(partial)).edges;
		expect(edges.find((e) => e.id === "a")?.fromHandle).toBe("if_1-success");
		expect(edges.find((e) => e.id === "b")?.fromHandle).toBe("if_1-failure");
	}
});

test("a canvas names both ends; ops that name no handle leave it to the canvas", () => {
	const whole = toGraph(diff(false)).edges.find((e) => e.id === "c");
	expect([whole?.fromHandle, whole?.toHandle]).toEqual(["log_1-source", "log_2-target"]);
	const ops = toGraph(diff(true)).edges.find((e) => e.id === "c");
	expect([ops?.fromHandle, ops?.toHandle]).toEqual(["", ""]);
});

test("an edge to a block that is not in the diff is left out", () => {
	const d = diff(false);
	d.edges.push({ id: "x", from: "if_1", to: "gone_1", handle: "success", status: "same" });
	expect(toGraph(d).edges.map((e) => e.id)).toEqual(["a", "b", "c"]);
});
