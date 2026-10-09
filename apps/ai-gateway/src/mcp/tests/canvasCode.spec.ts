import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { type CanvasOp, opsToChanges } from "../canvasOps";
import { canvasTools } from "../canvasTools";
import { lenient } from "../tools";

const SCRIPT = "const a = 1;\nconst b = 2;\nreturn a + b;";
const at = (x: number) => ({ x, y: 0 });

const canvas = () => ({
	canvasVersion: 3,
	blocks: [
		{ id: "entry", key: "entrypoint_1", type: "entrypoint", data: {}, position: at(0) },
		{ id: "js", key: "jsrunner_1", type: "jsrunner", data: { value: SCRIPT }, position: at(300) },
		{ id: "log", key: "consolelog_1", type: "consolelog", data: { value: "js: return input.id" }, position: at(600) },
		{ id: "resp", key: "response_1", type: "response", data: { httpCode: "200" }, position: at(900) },
	],
	edges: [],
});

const apply = (ops: object[]) => {
	const out = opsToChanges(canvas(), ops as CanvasOp[]);
	const block = (id: string) => out.changes.changes.blocks.find((b) => b.id === id);
	return { ...out, block, said: out.describe((x) => (x === "js" ? "jsrunner_1" : x)) };
};
const edit = (old: string, to: string, extra: object = {}) => ({
	op: "edit_code",
	id: "jsrunner_1",
	old,
	new: to,
	...extra,
});

describe("edit_code", () => {
	it("replaces one match in the main code field and says where", () => {
		const out = apply([edit("const b = 2;", "const b = 5;")]);
		expect(out.block("js")?.data).toEqual({ value: "const a = 1;\nconst b = 5;\nreturn a + b;" });
		expect(out.said).toEqual(["edited jsrunner_1.value (1 change, line 2)"]);
	});

	it("reports the lines a longer replacement now covers", () => {
		const out = apply([edit("return a + b;", "const c = a + b;\nlog(c);\nreturn c;")]);
		expect(out.said).toEqual(["edited jsrunner_1.value (1 change, lines 3–5)"]);
	});

	it("fails on no match, shows the closest text, and saves nothing", () => {
		expect(() => apply([edit("const b = 3;", "x")])).toThrow(/not found in jsrunner_1\.value/);
		expect(() => apply([edit("const b = 3;", "x")])).toThrow("const b = 2;");
		expect(() => apply([edit("nothing like it", "x")])).toThrow("The field has 3 lines");
	});

	it("fails on many matches, naming how many and where", () => {
		const twice = { ...canvas() };
		twice.blocks[1].data = { value: "x = 1;\ny = 2;\nx = 1;" };
		expect(() => opsToChanges(twice, [edit("x = 1;", "x = 9;")] as CanvasOp[])).toThrow(
			"found 2 times in jsrunner_1.value (lines 1, 3)",
		);
	});

	it("refuses an empty old", () => {
		expect(() => apply([edit("", "x")])).toThrow("old is empty");
	});

	it("edits a js: text field named by field, and asks for field where there is no main code field", () => {
		const out = apply([
			{ op: "edit_code", id: "consolelog_1", field: "value", old: "input.id", new: "input.userId" },
		]);
		expect(out.block("log")?.data).toEqual({ value: "js: return input.userId" });
		expect(() => apply([{ op: "edit_code", id: "consolelog_1", old: "a", new: "b" }])).toThrow(
			"has no code field of its own",
		);
		expect(() => apply([edit("a", "b", { field: "ghost" })])).toThrow("jsrunner_1.ghost is not a text field");
	});

	it("uses the response's transformScript by default", () => {
		const c = canvas();
		Object.assign(c.blocks[3], {
			data: { httpCode: "200", transformScript: "return { id: input.id };" },
		});
		const out = opsToChanges(c, [
			{ op: "edit_code", id: "response_1", old: "input.id", new: "input.uid" },
		] as CanvasOp[]);
		expect(out.changes.changes.blocks[0].data).toMatchObject({ transformScript: "return { id: input.uid };" });
	});

	it("builds on an earlier op in the same call, and works on a block added in it", () => {
		const out = apply([
			{ op: "update_block", id: "jsrunner_1", data: { value: "let n = 1;" } },
			edit("n = 1", "n = 2"),
			{ op: "add_block", ref: "fresh", type: "jsRunner", data: { value: "return 1;" } },
			{ op: "edit_code", id: "fresh", old: "1", new: "2" },
		]);
		expect(out.block("js")?.data).toEqual({ value: "let n = 2;" });
		expect(out.block(out.refs.fresh)?.data).toEqual({ value: "return 2;" });
	});

	it("works on a custom block's canvas, the one place its code lives", async () => {
		const sent: { path: string; body: any }[] = [];
		const api: AdminApi = {
			get: async () => canvas(),
			send: async (_m, path, body) => {
				sent.push({ path, body });
				return { canvasVersion: 4 };
			},
		};
		const tool = canvasTools.find((t) => t.name === "edit_canvas")!;
		const args = z.object(lenient(tool.input)).parse({
			target: { kind: "custom_block", id: "cb1" },
			version: 3,
			ops: [edit("a + b", "a * b")],
		});
		expect(await tool.call(api, args)).toEqual({
			version: 4,
			changes: ["edited jsrunner_1.value (1 change, line 3)"],
		});
		expect(sent[0].path).toBe("/v1/custom-blocks/cb1/save-canvas?expectedVersion=3");
		expect(sent[0].body.changes.blocks[0].data.value).toBe("const a = 1;\nconst b = 2;\nreturn a * b;");
	});
});
