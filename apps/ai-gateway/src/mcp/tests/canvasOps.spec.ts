import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { type CanvasOp, opsToChanges, trimCanvas } from "../canvasOps";
import { canvasTools } from "../canvasTools";
import { routeTools } from "../routeTools";

const at = (x: number) => ({ x, y: 0 });
/** entry → resp, plus an if block wired on success to log */
const canvas = () => ({
	canvasVersion: 3,
	blocks: [
		{ id: "entry", type: "entrypoint", data: {}, position: at(0) },
		{ id: "err", type: "error_handler", data: {}, position: at(0) },
		{ id: "resp", type: "response", data: { httpCode: "200" }, position: at(300) },
		{ id: "cond", type: "if", data: { conditions: [] }, position: at(600) },
		{ id: "log", type: "consolelog", data: { value: "x" }, position: at(900) },
	],
	edges: [
		{ id: "e1", from: "entry", to: "resp", fromHandle: "entry-source", toHandle: "resp-target" },
		{ id: "e2", from: "cond", to: "log", fromHandle: "cond-success", toHandle: "log-target" },
	],
});

const apply = (ops: CanvasOp[], autoLayout = false) => opsToChanges(canvas(), ops, autoLayout);
const upserts = (c: ReturnType<typeof apply>["changes"]) =>
	c.actionsToPerform.blocks.filter((a) => a.action === "upsert").map((a) => a.id);
const deletes = (c: ReturnType<typeof apply>["changes"], kind: "blocks" | "edges") =>
	c.actionsToPerform[kind].filter((a) => a.action === "delete").map((a) => a.id);

describe("edit_canvas ops → save diff", () => {
	it("adds a block by ref, gives it an id, and wires refs used later in the call", () => {
		const { changes, refs } = apply([
			{ op: "disconnect", from: "entry", to: "resp" },
			{ op: "add_block", ref: "block_1", type: "jsRunner", data: { value: "return 1" }, connect_from: { from: "entry" } },
			{ op: "connect", from: "block_1", to: "resp" },
		]);
		const id = refs.block_1;
		expect(id).toBeString();
		expect(id).not.toBe("block_1");
		const block = changes.changes.blocks.find((b) => b.id === id)!;
		expect(block.type).toBe("jsrunner");
		expect(changes.changes.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "entry", to: id, fromHandle: "entry-source", toHandle: `${id}-target` }),
				expect.objectContaining({ from: id, to: "resp", fromHandle: `${id}-source` }),
			]),
		);
		expect(deletes(changes, "edges")).toEqual(["e1"]);
		// placed by the layout, not left at the origin
		expect(block.position).not.toEqual({ x: 0, y: 0 });
	});

	it("fills in the default handle, and asks when there is none", () => {
		const { changes, refs } = apply([{ op: "add_block", ref: "b", type: "consolelog", connect_from: { from: "log" } }]);
		expect(changes.changes.edges[0].fromHandle).toBe("log-source");
		expect(refs.b).toBeString();
		expect(() => apply([{ op: "connect", from: "cond", to: "resp" }])).toThrow("success, failure");
		expect(() => apply([{ op: "connect", from: "resp", to: "log" }])).toThrow("no output handle");
		expect(() => apply([{ op: "connect", from: "cond", to: "resp", handle: "nope" }])).toThrow('no "nope" handle');
		const failure = apply([{ op: "connect", from: "cond", to: "resp", handle: "failure" }]);
		expect(failure.changes.changes.edges[0].fromHandle).toBe("cond-failure");
	});

	it("merges update_block data into the stored data and keeps its position", () => {
		const { changes } = apply([{ op: "update_block", id: "log", data: { level: "warn" } }]);
		expect(changes.changes.blocks).toEqual([
			expect.objectContaining({ id: "log", data: { value: "x", level: "warn" }, position: at(900) }),
		]);
		expect(changes.changes.edges).toEqual([]);
	});

	it("removes a block with its edges", () => {
		const { changes } = apply([{ op: "remove_block", id: "log" }]);
		expect(deletes(changes, "blocks")).toEqual(["log"]);
		expect(deletes(changes, "edges")).toEqual(["e2"]);
		expect(upserts(changes)).toEqual([]);
	});

	it("refuses bad ops instead of dropping them", () => {
		expect(() => apply([{ op: "connect", from: "entry", to: "ghost" }])).toThrow('no block "ghost"');
		expect(() => apply([{ op: "connect", from: "entry", to: "log" }])).toThrow("already goes to resp");
		expect(() => apply([{ op: "connect", from: "log", to: "entry" }])).toThrow("nothing may point");
		expect(() => apply([{ op: "remove_block", id: "entry" }])).toThrow("cannot be removed");
		expect(() => apply([{ op: "disconnect", from: "entry", to: "log" }])).toThrow("no edge");
		expect(() =>
			apply([
				{ op: "remove_block", id: "log" },
				{ op: "update_block", id: "log", data: {} },
			]),
		).toThrow("removed earlier");
		expect(() => apply([{ op: "add_block", ref: "resp", type: "response" }])).toThrow("already");
	});

	it("auto_layout moves stored blocks too, restating their data", () => {
		const { changes } = apply([], true);
		expect(changes.changes.blocks.length).toBeGreaterThan(0);
		const resp = changes.changes.blocks.find((b) => b.id === "resp");
		expect(resp?.data).toEqual({ httpCode: "200" });
	});

	it("get_canvas trims UI data and uses bare handles", () => {
		const out = trimCanvas(canvas());
		expect(out.version).toBe(3);
		expect(out.blocks[0]).toEqual({ id: "entry", type: "entrypoint", data: {} });
		expect(out.edges[1]).toEqual({ from: "cond", to: "log", handle: "success" });
	});
});

describe("edit_canvas tool", () => {
	const tool = canvasTools.find((t) => t.name === "edit_canvas")!;
	const fake = (version = 3) => {
		const sent: { path: string; body: unknown }[] = [];
		const api: AdminApi = {
			get: async () => ({ ...canvas(), canvasVersion: version }),
			send: async (_m, path, body) => {
				sent.push({ path, body });
				return { canvasVersion: 4, issues: [{ severity: "warning", message: "w" }] };
			},
		};
		return { api, sent };
	};
	const run = (api: AdminApi, args: object) => tool.call(api, z.object(tool.input).parse(args));
	const target = { kind: "route", id: "r1" };

	it("saves against the version read and returns the new one", async () => {
		const { api, sent } = fake();
		const out = await run(api, { target, version: 3, ops: [{ op: "update_block", id: "log", data: {} }] });
		expect(out).toEqual({ version: 4 });
		expect(sent[0].path).toBe("/v1/routes/r1/save-canvas?expectedVersion=3");
	});

	it("refuses a stale version without saving", async () => {
		const { api, sent } = fake(5);
		await expect(run(api, { target, version: 3, ops: [] })).rejects.toThrow("get_canvas");
		expect(sent).toEqual([]);
	});

	it("validate with no ops is a dry run that returns the issues", async () => {
		const { api, sent } = fake();
		const out = await run(api, { target: { kind: "workflow", id: "w" }, version: 3, ops: [], validate: true });
		expect(sent[0].path).toBe("/v1/workflows/w/save-canvas?expectedVersion=3&dryRun=true");
		expect(out).toEqual({ version: 4, issues: [{ severity: "warning", message: "w" }] });
	});
});

describe("save_route input", () => {
	it("checks the request schema shape and still converts to JSON Schema", () => {
		const input = z.object(routeTools.find((t) => t.name === "save_route")!.input);
		const ok = { bodySchema: { dataType: "object", properties: [{ key: "id", dataType: "int", required: true }] } };
		expect(input.safeParse(ok).success).toBe(true);
		expect(input.safeParse({ bodySchema: { dataType: "number" } }).success).toBe(false);
		expect(() => z.toJSONSchema(input, { io: "input" })).not.toThrow();
	});
});
