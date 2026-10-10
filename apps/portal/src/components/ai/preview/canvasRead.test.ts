import { expect, test } from "bun:test";
import type { ToolPart } from "../agentMessages";
import { canvasFromRead } from "./canvasRead";

const call = (input: unknown, output: unknown) =>
	({ type: "tool", id: "t", name: "get_canvas", input, output, status: "done" }) as ToolPart;
const full = {
	version: 3,
	blocks: [
		{ key: "entrypoint_1", type: "entrypoint", data: {} },
		{ key: "if_1", type: "if", note: "guards the insert", data: { condition: "x" } },
		{ key: "response_1", type: "response", data: { httpCode: "200" } },
		{ key: "note_1", type: "sticky_note", note: "a rule", data: { notes: "a rule" } },
	],
	edges: ["entrypoint_1 → if_1", "if_1.success → response_1", "if_1.failure → response_1"],
};

test("a full get_canvas is a canvas: blocks by key, edges with the handle they name", () => {
	const diff = canvasFromRead(call({ target: { kind: "route", id: "r" } }, full));
	expect(diff?.blocks.map((b) => b.key)).toEqual(["entrypoint_1", "if_1", "response_1", "note_1"]);
	expect(diff?.blocks.every((b) => b.status === "same")).toBe(true);
	expect(diff?.edges.map((e) => [e.from, e.handle, e.to])).toEqual([
		["entrypoint_1", "source", "if_1"],
		["if_1", "success", "response_1"],
		["if_1", "failure", "response_1"],
	]);
	// edges to the same block by two handles stay two edges
	expect(new Set(diff?.edges.map((e) => e.id)).size).toBe(3);
});

test("the note comes back into the block's data for its settings panel; a sticky note keeps its own", () => {
	const blocks = canvasFromRead(call({}, full))?.blocks;
	expect(blocks?.find((b) => b.key === "if_1")?.data).toEqual({
		condition: "x",
		blockDescription: "guards the insert",
	});
	expect(blocks?.find((b) => b.key === "note_1")?.data).toEqual({ notes: "a rule" });
});

test("compact reads and a chosen few blocks cannot be drawn faithfully", () => {
	expect(canvasFromRead(call({ compact: true }, full))).toBeNull();
	expect(canvasFromRead(call({ blocks: ["if_1"] }, full))).toBeNull();
});

test("an answer that is not a canvas is left to the plain view", () => {
	expect(canvasFromRead(call({}, "some text"))).toBeNull();
	expect(canvasFromRead(call({}, { ...full, blocks: [] }))).toBeNull();
	expect(canvasFromRead(call({}, { ...full, blocks: [{ key: "a", type: "log" }] }))).toBeNull();
	expect(canvasFromRead(call({}, { ...full, edges: ["not an edge"] }))).toBeNull();
});
