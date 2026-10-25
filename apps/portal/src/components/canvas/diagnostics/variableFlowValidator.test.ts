import { describe, expect, it } from "bun:test";
import type { CanvasBlock, CanvasEdge } from "../types";
import { validateVariableFlow } from "./variableFlowValidator";

const b = (id: string, type: string, data: Record<string, unknown> = {}): CanvasBlock => ({
	id,
	type,
	data: { blockName: id, ...data },
	position: { x: 0, y: 0 },
});
const e = (from: string, to: string, handle = "source"): CanvasEdge => ({
	id: `${from}-${to}`,
	from,
	to,
	fromHandle: `${from}-${handle}`,
	toHandle: `${to}-target`,
});
const run = (blocks: CanvasBlock[], edges: CanvasEdge[]) =>
	validateVariableFlow({ blocks, edges }).map((d) => [d.blockId, d.severity] as const);

const set = (id: string, key: string) => b(id, "setvar", { key, value: 1 });
const script = (id: string, value: string) => b(id, "jsrunner", { value });

describe("validateVariableFlow", () => {
	it("is quiet when the variable is set before it is read", () => {
		const blocks = [b("in", "entrypoint"), set("s", "total"), b("g", "getvar", { key: "total" })];

		expect(run(blocks, [e("in", "s"), e("s", "g")])).toEqual([]);
	});

	it("warns when Get Var reads a variable only set after it", () => {
		const blocks = [b("in", "entrypoint"), b("g", "getvar", { key: "total" }), set("s", "total")];

		expect(run(blocks, [e("in", "g"), e("g", "s")])).toEqual([["g", "warning"]]);
	});

	it("warns when the only writer is on another branch", () => {
		const blocks = [
			b("in", "entrypoint"),
			b("if", "if"),
			set("s", "total"),
			b("g", "getvar", { key: "total" }),
		];
		const edges = [e("in", "if"), e("if", "s", "success"), e("if", "g", "failure")];

		expect(run(blocks, edges)).toEqual([["g", "warning"]]);
	});

	it("only notes a variable nothing on the canvas sets, since a middleware may", () => {
		const blocks = [b("in", "entrypoint"), b("g", "getvar", { key: "ghost" })];

		expect(run(blocks, [e("in", "g")])).toEqual([["g", "info"]]);
	});

	it("checks every key of a multiple-mode Get Var", () => {
		const blocks = [
			b("in", "entrypoint"),
			set("s", "a"),
			b("g", "getvar", { mode: "multiple", items: [{ key: "a" }, { key: "b" }] }),
		];

		expect(run(blocks, [e("in", "s"), e("s", "g")])).toEqual([["g", "info"]]);
	});

	it("warns when a script reads a variable before a later block sets it", () => {
		const blocks = [b("in", "entrypoint"), script("r", "return total + 1"), set("s", "total")];

		expect(run(blocks, [e("in", "r"), e("r", "s")])).toEqual([["r", "warning"]]);
		expect(run(blocks, [e("in", "s"), e("s", "r")])).toEqual([]);
	});

	it("reads a js: value like a script", () => {
		const blocks = [
			b("in", "entrypoint"),
			b("w", "httprequest", { url: "js:return `/u/${total}`" }),
			set("s", "total"),
		];

		expect(run(blocks, [e("in", "w"), e("w", "s")])).toEqual([["w", "warning"]]);
	});

	it("does not count a property, a string, a comment, or a name the script declares", () => {
		const blocks = [
			b("in", "entrypoint"),
			script("r", 'const x = input.total; const y = "total"; // total\nreturn x'),
			script("d", "const total = 1; return total"),
			set("s", "total"),
		];

		expect(run(blocks, [e("in", "r"), e("r", "d"), e("d", "s")])).toEqual([]);
	});

	it("lets a Set Var read its own key", () => {
		const blocks = [
			b("in", "entrypoint"),
			b("s", "setvar", { key: "count", value: "js:return count + 1" }),
		];

		expect(run(blocks, [e("in", "s")])).toEqual([]);
	});

	it("checks outputs.<name> against the block that saves it", () => {
		const save = b("q", "db_count", { saveAsVariable: { enabled: true, name: "n" } });
		const blocks = [b("in", "entrypoint"), script("r", "return outputs.n"), save];

		expect(run(blocks, [e("in", "r"), e("r", "q")])).toEqual([["r", "warning"]]);
		expect(run([b("in", "entrypoint"), save, script("r", "return outputs.n")], [e("in", "q"), e("q", "r")])).toEqual([]);
		expect(run([b("in", "entrypoint"), script("r", "return outputs.nobody")], [e("in", "r")])).toEqual([
			["r", "info"],
		]);
	});

	it("skips a block nothing leads to, and the error handler", () => {
		const blocks = [
			b("in", "entrypoint"),
			script("orphan", "return total"),
			b("h", "error_handler", { value: "return total" }),
			set("s", "total"),
		];

		expect(run(blocks, [e("in", "s")])).toEqual([]);
	});

	it("counts a name a script assigns as a writer, and ignores one it declares", () => {
		const writer = script("w", "shared = 1; let local = 2; local = 3");
		const reader = script("r", "return shared + local");
		const blocks = [b("in", "entrypoint"), writer, reader];

		// `local` belongs to the writer's script, so it is not a variable at all
		expect(run(blocks, [e("in", "w"), e("w", "r")])).toEqual([]);
		expect(run(blocks, [e("in", "r"), e("r", "w")])).toEqual([["r", "warning"]]);
	});
});
