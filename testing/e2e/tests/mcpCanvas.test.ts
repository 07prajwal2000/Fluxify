import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adminCall, callTool, type McpStack, startMcpStack, stopMcpStack } from "../src/mcp";
import { uniq } from "../src/mcpRows";

// Canvas edits through the MCP tools against a real admin server and Postgres:
// blocks are named by key, the server hands the keys out, and they are never
// reused.
let stack: McpStack;

beforeAll(async () => {
	stack = await startMcpStack();
}, 300_000);

afterAll(stopMcpStack);

const call = async (tool: string, args: object) => {
	const r = await callTool(stack, stack.tokens.creator, tool, args);
	if (!r.ok) throw new Error(`${tool}: ${r.text}`);
	return JSON.parse(r.text);
};
const newWorkflow = async () => {
	const { id } = await call("save_workflow", { projectId: stack.projectId, name: uniq("cv-") });
	const target = { kind: "workflow", id };
	return { target, canvas: await call("get_canvas", { target }) };
};
const keyOf = (canvas: any, type: string) => canvas.blocks.find((b: any) => b.type === type).key;
const keys = (canvas: any) => canvas.blocks.map((b: any) => b.key);
const log = (ref: string, from?: string) => ({
	op: "add_block",
	ref,
	type: "consolelog",
	data: { value: "hi" },
	...(from ? { connect_from: { from } } : {}),
});

describe("MCP canvas edits", () => {
	it("refuses a stale version and saves nothing", async () => {
		const { target, canvas } = await newWorkflow();
		const add = log("b", keyOf(canvas, "entrypoint"));
		await call("edit_canvas", { target, version: canvas.version, ops: [add] });
		const stale = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ ...add, ref: "c" }],
		});
		expect(stale.ok).toBe(false);
		expect(stale.text).toContain("Read it again with get_canvas");
		// the server refuses it too, for any writer that sends the version
		const direct = await adminCall(stack, stack.tokens.creator, {
			method: "PUT",
			path: `/v1/workflows/${target.id}/save-canvas?expectedVersion=${canvas.version}`,
			body: { actionsToPerform: { blocks: [], edges: [] }, changes: { blocks: [], edges: [] } },
		});
		expect(direct.status).toBe(409);
		const now = await call("get_canvas", { target });
		expect(now.version).toBe(canvas.version + 1);
		expect(now.blocks).toHaveLength(canvas.blocks.length + 1);
	});

	it("validate with no ops returns the issues, by block key, and saves nothing", async () => {
		const { target, canvas } = await newWorkflow();
		// a Response block in a workflow is a warning: it still saves
		const saved = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [
				{
					op: "add_block",
					ref: "r",
					type: "response",
					data: { httpCode: "200" },
					connect_from: { from: keyOf(canvas, "entrypoint") },
				},
			],
			validate: true,
		});
		expect(saved.refs).toEqual({ r: "response_1" });
		expect(saved.issues).toEqual([
			expect.objectContaining({ severity: "warning", block: "response_1" }),
		]);

		const checked = await call("edit_canvas", { target, version: saved.version, ops: [], validate: true });
		expect(checked).toEqual({ version: saved.version, issues: saved.issues });
		expect((await call("get_canvas", { target })).version).toBe(saved.version);
	});

	it("warns about a route that does not reach a response, by block key (#704)", async () => {
		const name = uniq("rc-");
		const { id } = await call("save_route", {
			projectId: stack.projectId,
			name,
			path: `/${name}`,
			method: "GET",
		});
		const target = { kind: "route", id };
		const canvas = await call("get_canvas", { target });
		const entry = keyOf(canvas, "entrypoint");
		const response = keyOf(canvas, "response");
		const messages = (r: any) => r.issues.map((i: any) => i.message);

		// a new route has its entrypoint and response apart
		const fresh = await call("edit_canvas", { target, version: canvas.version, ops: [] });
		expect(messages(fresh)).toEqual([
			`${response} is not connected to the flow, so it never runs.`,
			expect.stringContaining("No path from entrypoint to a response block"),
		]);

		const wired = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "connect", from: entry, to: response }],
		});
		expect(wired.issues).toBeUndefined();

		const cut = await call("edit_canvas", {
			target,
			version: wired.version,
			ops: [{ op: "disconnect", from: entry, to: response }],
		});
		expect(messages(cut)).toEqual(messages(fresh));

		const branched = await call("edit_canvas", {
			target,
			version: cut.version,
			ops: [
				{
					op: "add_block",
					ref: "check",
					type: "if",
					data: { conditions: [{ lhs: "js: return 1;", rhs: 1, operator: "eq", chain: "and" }] },
					connect_from: { from: entry },
				},
				{ op: "connect", from: "check.success", to: response },
			],
		});
		expect(branched.issues).toEqual([
			expect.objectContaining({
				severity: "warning",
				block: "if_1",
				message: "if_1.failure is not connected: the flow stops there with no response.",
			}),
		]);
	});

	it("drops fields a block does not have, warns, and keeps free-form ones (#703)", async () => {
		const { target, canvas } = await newWorkflow();
		const handler = keyOf(canvas, "error_handler");
		const saved = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [
				{ op: "update_block", id: handler, data: { statusCode: 500, transform: "return 1;" } },
				{
					op: "add_block",
					ref: "req",
					type: "httprequest",
					data: { url: "https://x.test", method: "POST", headers: { "X-Any": "1" }, body: { a: [1] } },
					connect_from: { from: keyOf(canvas, "entrypoint") },
				},
			],
			validate: true,
		});
		expect(saved.issues).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				block: handler,
				message: expect.stringContaining("removed unknown field(s) statusCode, transform"),
			}),
		);
		const stored = (await call("get_canvas", { target })).blocks;
		const after = stored.find((b: any) => b.key === handler);
		expect(after.data).not.toHaveProperty("statusCode");
		expect(after.data).not.toHaveProperty("transform");
		const request = stored.find((b: any) => b.key === saved.refs.req);
		expect(request.data).toMatchObject({ headers: { "X-Any": "1" }, body: { a: [1] } });
	});

	it("refuses a bad op readably and saves nothing", async () => {
		const { target, canvas } = await newWorkflow();
		const bad = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "connect", from: "nope", to: "also-nope" }],
		});
		expect(bad).toEqual({ ok: false, text: expect.stringContaining('no block "nope"') });
		const typo = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "update_block", id: "entrypoint_7", data: {} }],
		});
		expect(typo.text).toContain("Similar keys: entrypoint_1");
		const unknown = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "add_block", ref: "x", type: "not_a_block" }],
		});
		expect(unknown.text).toContain("Unknown block type");
		expect((await call("get_canvas", { target })).version).toBe(canvas.version);
	});
});

describe("MCP block keys", () => {
	it("starts a canvas with keys, and shows edges by key", async () => {
		const { target, canvas } = await newWorkflow();
		expect(keys(canvas)).toEqual(expect.arrayContaining(["entrypoint_1", "error_handler_1"]));
		const saved = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [log("a", "entrypoint_1"), log("b", "a")],
		});
		expect(saved.refs).toEqual({ a: "consolelog_1", b: "consolelog_2" });
		expect(saved.changes).toEqual([
			expect.stringContaining("added consolelog_1 (a); its output: "),
			"connected entrypoint_1 → consolelog_1",
			expect.stringContaining("added consolelog_2 (b); its output: "),
			"connected consolelog_1 → consolelog_2",
		]);
		const after = await call("get_canvas", { target });
		expect(after.edges.sort()).toEqual(["consolelog_1 → consolelog_2", "entrypoint_1 → consolelog_1"]);
		expect(JSON.stringify(after)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
	});

	it("never gives a key out twice, even after the newest block is deleted", async () => {
		const { target, canvas } = await newWorkflow();
		let version = canvas.version;
		const edit = async (ops: object[]) => {
			const out = await call("edit_canvas", { target, version, ops });
			version = out.version;
			return out;
		};
		expect((await edit([log("a"), log("b")])).refs).toEqual({ a: "consolelog_1", b: "consolelog_2" });
		// the highest number goes: a max()+1 scheme would hand consolelog_2 out again
		await edit([{ op: "remove_block", id: "consolelog_2" }]);
		expect((await edit([log("c")])).refs).toEqual({ c: "consolelog_3" });
		// and so does every block of the type: the next one is still a new number
		await edit([
			{ op: "remove_block", id: "consolelog_1" },
			{ op: "remove_block", id: "consolelog_3" },
		]);
		expect(keys(await call("get_canvas", { target }))).not.toContain("consolelog_3");
		expect((await edit([log("d")])).refs).toEqual({ d: "consolelog_4" });
	});

	it("numbers each type and each canvas on its own", async () => {
		const first = await newWorkflow();
		const second = await newWorkflow();
		for (const { target, canvas } of [first, second]) {
			const out = await call("edit_canvas", {
				target,
				version: canvas.version,
				ops: [log("a"), { op: "add_block", ref: "s", type: "setvar", data: { key: "k", value: "v" } }],
			});
			expect(out.refs).toEqual({ a: "consolelog_1", s: "setvar_1" });
		}
	});

	it("takes ids as well as keys, and a client cannot choose or change a key", async () => {
		const { target, canvas } = await newWorkflow();
		const items = `/v1/workflows/${target.id}/canvas-items`;
		const stored = (await adminCall(stack, stack.tokens.creator, { path: items })).body;
		const entry = stored.blocks.find((b: any) => b.type === "entrypoint");
		expect(entry.key).toBe("entrypoint_1");

		// an id still names the block
		const byId = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "update_block", id: entry.id, data: {} }],
		});
		expect(byId.changes).toEqual(["updated entrypoint_1 (no fields)"]);

		// a save that sends keys of its own: a new block's is replaced, a stored block's kept
		const saved = await adminCall(stack, stack.tokens.creator, {
			method: "PUT",
			path: `/v1/workflows/${target.id}/save-canvas`,
			body: {
				actionsToPerform: {
					blocks: [
						{ id: entry.id, action: "upsert" },
						{ id: "7f000000-0000-7000-8000-000000000001", action: "upsert" },
					],
					edges: [],
				},
				changes: {
					blocks: [
						{ ...entry, key: "response_9" },
						{
							id: "7f000000-0000-7000-8000-000000000001",
							key: "entrypoint_1",
							type: "consolelog",
							data: { value: "x" },
							position: { x: 0, y: 0 },
						},
					],
					edges: [],
				},
			},
		});
		expect(saved.status).toBe(200);
		expect(saved.body.newKeys).toEqual({ "7f000000-0000-7000-8000-000000000001": "consolelog_1" });
		const after = (await adminCall(stack, stack.tokens.creator, { path: items })).body;
		expect(after.blocks.map((b: any) => b.key).sort()).toEqual([
			"consolelog_1",
			"entrypoint_1",
			"error_handler_1",
		]);
	});
});
