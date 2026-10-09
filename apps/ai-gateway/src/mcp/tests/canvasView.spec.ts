import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { type CanvasOp, opsToChanges, trimCanvas } from "../canvasOps";
import { canvasTools } from "../canvasTools";
import { lenient } from "../tools";

const at = (x: number) => ({ x, y: 0 });
const SCRIPT = Array.from({ length: 24 }, (_, i) => `step(${i});`).join("\n");

const canvas = () => ({
	canvasVersion: 7,
	blocks: [
		{ id: "entry", key: "entrypoint_1", type: "entrypoint", data: {}, position: at(0) },
		{
			id: "js",
			key: "jsrunner_1",
			type: "jsrunner",
			data: { value: SCRIPT, blockName: "Hash it", blockDescription: "Parks the hash: KV returns true" },
			position: at(300),
		},
		{
			id: "resp",
			key: "response_1",
			type: "response",
			// the placeholder every new block starts with
			data: { httpCode: "js: return input.ok ? 200 : 400", blockDescription: "Description" },
			position: at(600),
		},
		{ id: "log", key: "consolelog_1", type: "consolelog", data: { value: "x".repeat(120) }, position: at(900) },
		{ id: "note", key: "sticky_note_1", type: "sticky_note", data: { notes: "passwords: salt:hash" }, position: at(0) },
	],
	edges: [
		{ id: "e1", from: "entry", to: "js", fromHandle: "entry-source", toHandle: "js-target" },
		{ id: "e2", from: "js", to: "resp", fromHandle: "js-source", toHandle: "resp-target" },
	],
});

describe("get_canvas notes", () => {
	it("shows a block's note beside its data and hides the default placeholder", () => {
		const { blocks } = trimCanvas(canvas());
		expect(blocks[1]).toMatchObject({ key: "jsrunner_1", note: "Parks the hash: KV returns true" });
		expect(blocks[1].data).not.toHaveProperty("blockDescription");
		expect(blocks[1].data).toMatchObject({ blockName: "Hash it" });
		expect(blocks[2]).not.toHaveProperty("note");
		expect(blocks[2].data).not.toHaveProperty("blockDescription");
	});
});

describe("get_canvas compact", () => {
	const { blocks, edges, version } = trimCanvas(canvas(), { compact: true });
	const byKey = Object.fromEntries(blocks.map((b: any) => [b.key, b]));

	it("keeps key, type, note and a one-line summary, with edges and version as before", () => {
		expect(version).toBe(7);
		expect(edges).toEqual(["entrypoint_1 → jsrunner_1", "jsrunner_1 → response_1"]);
		expect(byKey.jsrunner_1).toEqual({
			key: "jsrunner_1",
			type: "jsrunner",
			note: "Parks the hash: KV returns true",
			summary: 'blockName="Hash it"; value=code: 24 lines',
		});
		expect(blocks[0]).toEqual({ key: "entrypoint_1", type: "entrypoint" });
	});

	it("shows js: inputs as a line count, cuts long literals, and hides the placeholder", () => {
		expect(byKey.response_1.summary).toBe("httpCode=js: 1 line");
		expect(byKey.response_1).not.toHaveProperty("note");
		expect(byKey.consolelog_1.summary.length).toBeLessThan(70);
		expect(byKey.consolelog_1.summary).toContain("…");
	});

	it("a sticky note is its own note", () => {
		expect(byKey.sticky_note_1.note).toBe("passwords: salt:hash");
	});

	it("leaves the code itself out", () => {
		expect(JSON.stringify(trimCanvas(canvas(), { compact: true }))).not.toContain("step(5)");
		expect(JSON.stringify(trimCanvas(canvas()))).toContain("step(5)");
	});
});

describe("get_canvas blocks", () => {
	it("returns full data for just those blocks and the edges touching them", () => {
		const out = trimCanvas(canvas(), { blocks: ["response_1"] });
		expect(out.blocks.map((b: any) => b.key)).toEqual(["response_1"]);
		expect(out.blocks[0]).toHaveProperty("data");
		expect(out.edges).toEqual(["jsrunner_1 → response_1"]);
		expect(out.version).toBe(7);
	});

	it("names the keys when one does not exist", () => {
		expect(() => trimCanvas(canvas(), { blocks: ["ghost_9"] })).toThrow(/no block "ghost_9"\. Keys: entrypoint_1/);
	});

	it("the tool takes both, and the version works with edit_canvas either way", async () => {
		const sent: string[] = [];
		const api: AdminApi = {
			get: async () => canvas(),
			send: async (_m, path) => {
				sent.push(path);
				return { canvasVersion: 8 };
			},
		};
		const get = canvasTools.find((t) => t.name === "get_canvas")!;
		const edit = canvasTools.find((t) => t.name === "edit_canvas")!;
		const compact: any = await get.call(api, z.object(lenient(get.input)).parse({ target: { kind: "route", id: "r" }, compact: "true" }));
		const one: any = await get.call(api, z.object(lenient(get.input)).parse({ target: { kind: "route", id: "r" }, blocks: ["jsrunner_1"] }));
		expect(compact.blocks[1]).toHaveProperty("summary");
		expect(one.blocks).toHaveLength(1);
		for (const read of [compact, one]) {
			const args = z.object(lenient(edit.input)).parse({
				target: { kind: "route", id: "r" },
				version: read.version,
				ops: [{ op: "update_block", id: "jsrunner_1", data: { blockDescription: "why" } }],
			});
			expect(await edit.call(api, args)).toMatchObject({ version: 8 });
		}
		expect(sent).toEqual(Array(2).fill("/v1/routes/r/save-canvas?expectedVersion=7"));
	});
});

describe("edit_canvas add_block", () => {
	it("says what the new block outputs", () => {
		const out = opsToChanges(canvas(), [{ op: "add_block", ref: "n", type: "jsRunner" }] as CanvasOp[]);
		const [line] = out.describe((x) => (x === "n" ? "jsrunner_2" : x));
		expect(line).toStartWith("added jsrunner_2 (n); its output: ");
		expect(line.length).toBeGreaterThan("added jsrunner_2 (n); its output: ".length);
	});
});
