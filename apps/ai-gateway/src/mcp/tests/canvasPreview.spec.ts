import { describe, expect, it } from "bun:test";
import type { AdminApi } from "../adminApi";
import { previewEdit, previewInput } from "../canvasPreview";

const id = (n: number) => `01a11e04-fc64-7ff7-8e9d-${String(n).padStart(12, "0")}`;
const at = { x: 0, y: 0 };
const [ENTRY, RESPONSE, LOG] = [1, 2, 3].map(id);
const target = { kind: "route" as const, id: "r1" };

const canvas = () => ({
	canvasVersion: 7,
	blocks: [
		{ id: ENTRY, key: "entrypoint_1", type: "entrypoint", data: {}, position: at },
		{ id: RESPONSE, key: "response_1", type: "response", data: { httpCode: "200" }, position: at },
		{ id: LOG, key: "consolelog_1", type: "consolelog", data: {}, position: at },
	],
	edges: [
		{ id: id(11), from: ENTRY, to: RESPONSE, fromHandle: `${ENTRY}-source`, toHandle: `${RESPONSE}-target` },
	],
});

/** An admin API that records what it was asked and answers the dry run like the server does. */
function fakeApi(dry: (body: any) => unknown = (b) => ({
	canvasVersion: 7,
	issues: [],
	newKeys: Object.fromEntries(b.changes.blocks.filter((x: any) => !x.key && x.id !== LOG).map((x: any) => [x.id, "consolelog_2"])),
})) {
	const sent: { method: string; path: string; body: unknown }[] = [];
	const api: AdminApi = {
		get: async () => canvas(),
		send: async (method, path, body) => {
			sent.push({ method, path, body });
			const out = dry(body);
			if (out instanceof Error) throw out;
			return out;
		},
	};
	return { api, sent };
}

describe("previewEdit", () => {
	it("returns the canvas before and after the ops, by key, without saving", async () => {
		const { api, sent } = fakeApi();
		const out = await previewEdit(api, target, [
			{ op: "update_block", id: "response_1", data: { httpCode: "201" } },
			{ op: "disconnect", from: "entrypoint_1", to: "response_1" },
			{ op: "add_block", ref: "b1", type: "consolelog", connect_from: { from: "entrypoint_1" } },
			{ op: "remove_block", id: "consolelog_1" },
		]);
		expect(out.version).toBe(7);
		expect(out.before.blocks.map((b) => b.key)).toEqual(["entrypoint_1", "response_1", "consolelog_1"]);
		const keys = out.after?.blocks.map((b) => b.key);
		expect(keys).toEqual(["entrypoint_1", "response_1", "consolelog_2"]);
		expect(out.after?.blocks.find((b) => b.key === "response_1")?.data).toMatchObject({ httpCode: "201" });
		const added = out.after?.blocks.find((b) => b.key === "consolelog_2");
		expect(out.after?.edges.some((e) => e.to === added?.id && e.handle === "source")).toBe(true);
		expect(out.changes).toContain("removed consolelog_1");
		// one dry run, never a save
		expect(sent).toHaveLength(1);
		expect(sent[0].method).toBe("PUT");
		expect(sent[0].path).toBe("/v1/routes/r1/save-canvas?expectedVersion=7&dryRun=true");
	});

	it("an edge reads from, to and the bare handle", async () => {
		const { api } = fakeApi();
		const out = await previewEdit(api, target, []);
		expect(out.before.edges).toEqual([{ id: id(11), from: ENTRY, to: RESPONSE, handle: "source" }]);
	});

	it("a refused op comes back as an error with the canvas before, and no dry run", async () => {
		const { api, sent } = fakeApi();
		const out = await previewEdit(api, target, [{ op: "update_block", id: "response_9", data: {} }]);
		expect(out.error).toContain("response_9");
		expect(out.after).toBeUndefined();
		expect(out.before.blocks).toHaveLength(3);
		expect(sent).toHaveLength(0);
	});

	it("a save the server would refuse is an error beside the after canvas, with keys in it", async () => {
		const { api } = fakeApi(() => new Error(`Cycle at ${LOG}`));
		const out = await previewEdit(api, target, [{ op: "update_block", id: "consolelog_1", data: { a: 1 } }]);
		expect(out.error).toBe("Cycle at consolelog_1");
		expect(out.after?.blocks).toHaveLength(3);
	});

	it("rule issues come back naming blocks by key", async () => {
		const { api } = fakeApi(() => ({
			canvasVersion: 7,
			newKeys: {},
			issues: [{ severity: "warning", message: "not connected", blockId: LOG }],
		}));
		const out = await previewEdit(api, target, [{ op: "update_block", id: "consolelog_1", data: {} }]);
		expect(out.issues).toEqual([{ severity: "warning", message: "not connected", block: "consolelog_1" }]);
	});
});

describe("previewInput", () => {
	it("takes edit_canvas's target and ops, and no version", () => {
		const ok = previewInput.safeParse({ target, ops: [{ op: "remove_block", id: "log_1" }] });
		expect(ok.success).toBe(true);
		expect(previewInput.safeParse({ target, ops: "not ops" }).success).toBe(false);
	});
});
