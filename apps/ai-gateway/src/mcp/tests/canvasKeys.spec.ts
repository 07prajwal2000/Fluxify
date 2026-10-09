import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { type CanvasOp, opsToChanges, trimCanvas } from "../canvasOps";
import { canvasTools } from "../canvasTools";
import { lenient } from "../tools";

// ids that differ only in the last group: what the agent used to confuse
const id = (n: number) => `01a11e04-fc64-7ff7-8e9d-${String(n).padStart(12, "0")}`;
const at = { x: 0, y: 0 };
const [ENTRY, ERROR, RESPONSE, IF, LOG, OTHER_LOG] = [1, 2, 3, 4, 5, 6].map(id);

/** entry → response, an if with its success on a log, and a second, loose log */
const canvas = () => ({
	canvasVersion: 7,
	blocks: [
		{ id: ENTRY, key: "entrypoint_1", type: "entrypoint", data: {}, position: at },
		{ id: ERROR, key: "error_handler_1", type: "error_handler", data: {}, position: at },
		{ id: RESPONSE, key: "response_1", type: "response", data: { httpCode: "200" }, position: at },
		{ id: IF, key: "if_1", type: "if", data: { conditions: [] }, position: at },
		{ id: LOG, key: "consolelog_1", type: "consolelog", data: {}, position: at },
		{ id: OTHER_LOG, key: "consolelog_2", type: "consolelog", data: {}, position: at },
	],
	edges: [
		{ id: id(11), from: ENTRY, to: RESPONSE, fromHandle: `${ENTRY}-source`, toHandle: `${RESPONSE}-target` },
		{ id: id(12), from: IF, to: LOG, fromHandle: `${IF}-success`, toHandle: `${LOG}-target` },
		{ id: id(13), from: IF, to: OTHER_LOG, fromHandle: `${IF}-failure`, toHandle: `${OTHER_LOG}-target` },
	],
});

const apply = (ops: CanvasOp[]) => opsToChanges(canvas(), ops);
const target = { kind: "route", id: "r1" };

describe("block keys in edit_canvas ops", () => {
	it("a key and the block's id name the same block", () => {
		const byKey = apply([{ op: "update_block", id: "consolelog_1", data: { value: "a" } }]);
		const byId = apply([{ op: "update_block", id: LOG, data: { value: "a" } }]);
		expect(byKey.changes).toEqual(byId.changes);
		expect(byKey.changes.changes.blocks[0].id).toBe(LOG);
	});

	it("connect and disconnect take keys, a dotted from, or ids", () => {
		const plain = apply([
			{ op: "disconnect", from: "if_1", to: "consolelog_1", handle: "success" },
			{ op: "connect", from: "if_1", to: "consolelog_1", handle: "success" },
		]);
		const dotted = apply([
			{ op: "disconnect", from: "if_1.success", to: "consolelog_1" },
			{ op: "connect", from: "if_1.success", to: "consolelog_1" },
		]);
		const ids = apply([
			{ op: "disconnect", from: IF, to: LOG, handle: "success" },
			{ op: "connect", from: IF, to: LOG, handle: "success" },
		]);
		expect(dotted.changes).toEqual(plain.changes);
		expect(ids.changes).toEqual(plain.changes);
		expect(() => apply([{ op: "connect", from: "if_1.success", to: "consolelog_2", handle: "failure" }])).toThrow(
			"names the success handle but handle is failure",
		);
	});

	it("a ref cannot shadow a key", () => {
		expect(() => apply([{ op: "add_block", ref: "if_1", type: "consolelog" }])).toThrow("already a block key");
	});

	it("a key removed earlier in the call says so", () => {
		expect(() =>
			apply([
				{ op: "remove_block", id: "consolelog_1" },
				{ op: "connect", from: "if_1", to: "consolelog_1", handle: "success" },
			]),
		).toThrow("consolelog_1 was removed earlier");
	});

	it("refuses a key whose type is not the block's, naming both", () => {
		const stale = canvas();
		stale.blocks[2] = { ...stale.blocks[2], key: "error_handler_2" };
		expect(() => opsToChanges(stale, [{ op: "update_block", id: "error_handler_2", data: {} }])).toThrow(
			"error_handler_2 is a response block, not a error_handler block",
		);
	});

	it("an unknown key lists the keys it may have meant", () => {
		const message = (ops: CanvasOp[]) => {
			try {
				apply(ops);
			} catch (e) {
				return (e as Error).message;
			}
		};
		expect(message([{ op: "update_block", id: "consolelog_3", data: {} }])).toContain(
			"Similar keys: consolelog_1, consolelog_2",
		);
		expect(message([{ op: "update_block", id: "banana_1", data: {} }])).toContain(
			"Keys: entrypoint_1, error_handler_1, response_1, if_1, consolelog_1, consolelog_2",
		);
		expect(message([{ op: "update_block", id: id(99), data: {} }])).toContain("no block");
	});
});

describe("get_canvas by key", () => {
	it("shows keys and edges as from.handle → to, with no ids", () => {
		const out = trimCanvas(canvas());
		expect(out.blocks.map((b) => b.key)).toEqual([
			"entrypoint_1",
			"error_handler_1",
			"response_1",
			"if_1",
			"consolelog_1",
			"consolelog_2",
		]);
		expect(out.edges).toEqual([
			"entrypoint_1 → response_1",
			"if_1.success → consolelog_1",
			"if_1.failure → consolelog_2",
		]);
		expect(JSON.stringify(out)).not.toContain("01a11e04");
	});
});

describe("edit_canvas result", () => {
	const tool = canvasTools.find((t) => t.name === "edit_canvas")!;
	const fake = (answer: object | Error = {}) => {
		const api: AdminApi = {
			get: async () => canvas(),
			send: async () => {
				if (answer instanceof Error) throw answer;
				return { canvasVersion: 8, issues: [], newKeys: {}, ...answer };
			},
		};
		return api;
	};
	const run = (api: AdminApi, ops: object[], extra: object = {}) =>
		tool.call(api, z.object(lenient(tool.input)).parse({ target, version: 7, ops, ...extra }));

	it("says what every op changed, and the key the server gave each new block", async () => {
		let sentIds: string[] = [];
		const api = fake();
		api.send = async (_m, _p, body: any) => {
			sentIds = body.changes.blocks.map((b: { id: string }) => b.id);
			const added = body.changes.blocks.find((b: { id: string; type: string }) => b.type === "consolelog" && b.id !== LOG);
			return { canvasVersion: 8, issues: [], newKeys: { [added.id]: "consolelog_3" } };
		};
		const out = await run(api, [
			{ op: "update_block", id: "response_1", data: { httpCode: "201", transform: "x" } },
			{ op: "disconnect", from: "if_1.success", to: "consolelog_1" },
			{ op: "add_block", ref: "log", type: "consolelog", connect_from: { from: "if_1", handle: "success" } },
			{ op: "connect", from: "log", to: "response_1" },
			{ op: "remove_block", id: "consolelog_2" },
		]);
		expect(out).toEqual({
			version: 8,
			changes: [
				"updated response_1 (httpCode, transform)",
				"disconnected if_1.success → consolelog_1",
				expect.stringContaining("added consolelog_3 (log); its output: "),
				"connected if_1.success → consolelog_3",
				"connected consolelog_3 → response_1",
				"removed consolelog_2 (+1 edge)",
			],
			refs: { log: "consolelog_3" },
		});
		expect(sentIds).toContain(RESPONSE);
	});

	it("shows an issue's block by key and keeps ids out of messages", async () => {
		const out = (await run(
			fake({
				issues: [
					{ severity: "warning", message: "nothing runs after it", blockId: RESPONSE },
					{ severity: "error", message: `see ${LOG}`, blockId: LOG },
					{ severity: "warning", message: "no block" },
				],
			}),
			[],
			{ validate: true },
		)) as { issues: unknown[] };
		expect(out.issues).toEqual([
			{ severity: "warning", message: "nothing runs after it", block: "response_1" },
			{ severity: "error", message: "see consolelog_1", block: "consolelog_1" },
			{ severity: "warning", message: "no block" },
		]);
	});

	it("shows keys, not ids, in a refusal from the server", async () => {
		const failure = new Error(`Canvas has multiple outgoing edges on block ${IF}'s success handle (${id(12)}, ${id(99)}).`);
		await expect(run(fake(failure), [{ op: "update_block", id: "response_1", data: {} }])).rejects.toThrow(
			`Canvas has multiple outgoing edges on block if_1's success handle (if_1.success → consolelog_1, ${id(99)}).`,
		);
	});
});
