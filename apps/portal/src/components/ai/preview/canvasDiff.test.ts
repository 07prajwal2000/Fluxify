import { expect, test } from "bun:test";
import type { CanvasView } from "@fluxify/ai-gateway/src/mcp/canvasPreview";
import { countBy, diffCanvases, diffFromOps, fieldChanges } from "./canvasDiff";
import { mask } from "./data";
import { diffLines, withContext } from "./lineDiff";

const at = { x: 0, y: 0 };
const block = (id: string, key: string, type: string, data: object = {}) => ({
	id,
	key,
	type,
	data,
	position: at,
});
const edge = (id: string, from: string, to: string, handle = "source") => ({ id, from, to, handle });

const before: CanvasView = {
	blocks: [
		block("e", "entrypoint_1", "entrypoint"),
		block("r", "response_1", "response", { httpCode: "200" }),
		block("l", "consolelog_1", "consolelog", { value: "a" }),
	],
	edges: [edge("1", "e", "r"), edge("2", "e", "l")],
};
const after: CanvasView = {
	blocks: [
		block("e", "entrypoint_1", "entrypoint"),
		block("r", "response_1", "response", { httpCode: "201" }),
		block("n", "db_insert_1", "db_insert", { table: "users" }),
	],
	edges: [edge("1", "e", "r"), edge("3", "r", "n")],
};

test("a canvas diff tells added, removed and changed blocks apart, by key", () => {
	const diff = diffCanvases(before, after);
	const status = Object.fromEntries(diff.blocks.map((b) => [b.key, b.status]));
	expect(status).toEqual({
		entrypoint_1: "same",
		response_1: "changed",
		db_insert_1: "added",
		consolelog_1: "removed",
	});
	expect(countBy(diff)).toEqual({ added: 1, removed: 1, changed: 1 });
});

test("a changed block lists the fields that differ, before and after", () => {
	const changed = diffCanvases(before, after).blocks.find((b) => b.key === "response_1");
	expect(changed?.changes).toEqual([{ field: "httpCode", before: "200", after: "201" }]);
	const added = diffCanvases(before, after).blocks.find((b) => b.key === "db_insert_1");
	expect(added?.changes).toEqual([{ field: "table", after: "users" }]);
});

test("edges are added or removed by id, named by block key", () => {
	const edges = diffCanvases(before, after).edges.map((e) => `${e.status} ${e.from}.${e.handle}>${e.to}`);
	expect(edges).toEqual([
		"same entrypoint_1.source>response_1",
		"added response_1.source>db_insert_1",
		"removed entrypoint_1.source>consolelog_1",
	]);
});

test("field changes ignore key order and see nested differences", () => {
	expect(fieldChanges({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toEqual([]);
	expect(fieldChanges({ a: { x: 1 } }, { a: { x: 2 } })).toHaveLength(1);
	expect(fieldChanges({ a: 1 }, {})).toEqual([{ field: "a", before: 1 }]);
});

test("an applied edit shows the touched blocks from its ops, added ones under the key they were given", () => {
	const diff = diffFromOps(
		[
			{ op: "add_block", ref: "b1", type: "consolelog", data: { value: "x" }, connect_from: { from: "if_1.success" } },
			{ op: "update_block", id: "response_1", data: { httpCode: "201" } },
			{ op: "edit_code", id: "jsrunner_1", old: "a", new: "b" },
			{ op: "remove_block", id: "log_2" },
			{ op: "disconnect", from: "entrypoint_1", to: "response_1" },
		],
		{ b1: "consolelog_3" },
	);
	const status = Object.fromEntries(diff.blocks.map((b) => [b.key, b.status]));
	expect(status).toMatchObject({
		consolelog_3: "added",
		response_1: "changed",
		jsrunner_1: "changed",
		log_2: "removed",
		if_1: "same",
	});
	expect(diff.blocks.find((b) => b.key === "jsrunner_1")?.changes).toEqual([
		{ field: "code", before: "a", after: "b" },
	]);
	expect(diff.edges.map((e) => `${e.status} ${e.from}.${e.handle}>${e.to}`)).toEqual([
		"added if_1.success>consolelog_3",
		"removed entrypoint_1.source>response_1",
	]);
});

test("a line diff marks what went and what came, and folds long unchanged runs", () => {
	const lines = diffLines("a\nb\nc", "a\nB\nc");
	expect(lines).toEqual([
		{ kind: "same", text: "a" },
		{ kind: "del", text: "b" },
		{ kind: "add", text: "B" },
		{ kind: "same", text: "c" },
	]);
	const long = Array.from({ length: 20 }, (_, i) => `line ${i}`);
	const folded = withContext(diffLines(long.join("\n"), long.with(10, "changed").join("\n")));
	expect(folded.filter((l) => l === null)).toHaveLength(2);
	expect(folded.length).toBeLessThan(12);
});

test("secrets are hidden at any depth; a cfg: reference is not one", () => {
	expect(mask({ host: "db", password: "p", nested: { apiKey: "k", token: "cfg:DB_TOKEN" } })).toEqual({
		host: "db",
		password: "••••••••",
		nested: { apiKey: "••••••••", token: "cfg:DB_TOKEN" },
	});
});
