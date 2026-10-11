import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { copyBlocksTool } from "../copyBlocks";
import { sandboxTools } from "../sandboxTools";

type Call = { method: string; path: string; body?: any };

const P = "019a0000-0000-7000-8000-000000000000";
const OTHER = "019a0000-0000-7000-8000-000000000001";
const pos = { x: 0, y: 0 };
const block = (id: string, key: string, type: string, data: object = {}, x = 0) => ({
	id,
	key,
	type,
	data,
	position: { x, y: 0 },
});
const edge = (id: string, from: string, handle: string, to: string) => ({
	id,
	from,
	to,
	fromHandle: `${from}-${handle}`,
	toHandle: `${to}-target`,
});

/** a route: entry → fetch → if (success → ok, failure → fail) */
const ROUTE_CANVAS = {
	canvasRevision: 4,
	blocks: [
		block("en", "entrypoint_1", "entrypoint", {}, 0),
		block("eh", "error_handler_1", "error_handler", {}, 0),
		block("fx", "jsrunner_1", "jsrunner", { value: "return 1", blockName: "fetch" }, 100),
		block("if", "if_1", "if", { blockName: "check" }, 200),
		block("ok", "response_1", "response", { httpCode: 200 }, 300),
		block("no", "response_2", "response", { httpCode: 500 }, 300),
	],
	edges: [
		edge("e1", "en", "source", "fx"),
		edge("e2", "fx", "source", "if"),
		edge("e3", "if", "success", "ok"),
		edge("e4", "if", "failure", "no"),
	],
};
const SANDBOX_CANVAS = {
	canvasRevision: 1,
	blocks: [
		block("sen", "entrypoint_1", "entrypoint"),
		block("seh", "error_handler_1", "error_handler"),
		block("sjs", "jsrunner_1", "jsrunner", { value: "return 2" }, 100),
	],
	edges: [edge("s1", "sen", "source", "sjs")],
};

type World = {
	routeProject?: string;
	middlewares?: { before: unknown[]; after: unknown[] };
	saveFails?: string;
};

function fakeApi(w: World = {}) {
	const calls: Call[] = [];
	const answer = (method: string, path: string) => {
		if (method === "POST" && path.endsWith("/sandboxes")) return { id: "new-sb" };
		if (method === "PUT") {
			if (w.saveFails) throw new Error(w.saveFails);
			return { canvasRevision: 2, newKeys: {}, issues: [] };
		}
		if (method === "DELETE") return {};
		if (path === "/v1/routes/r1")
			return {
				name: "Orders",
				projectId: w.routeProject ?? P,
				bodySchema: { type: "object" },
				querySchema: {},
			};
		if (path === "/v1/routes/r1/middlewares") return w.middlewares ?? { before: [], after: [] };
		if (path === "/v1/routes/r1/canvas-items") return ROUTE_CANVAS;
		if (path === "/v1/routes/r2") return { name: "Other", projectId: P };
		if (path === "/v1/routes/r2/canvas-items") return SANDBOX_CANVAS;
		if (path === "/v1/workflows/w1") return { name: null, projectId: P };
		if (path === "/v1/workflows/w1/canvas-items") return SANDBOX_CANVAS;
		if (path === `/v1/projects/${P}/sandboxes/sb1`) return { name: "Mine", projectId: P };
		if (path === `/v1/projects/${P}/sandboxes/sb1/canvas-items`) return SANDBOX_CANVAS;
		if (path === `/v1/projects/${P}/sandboxes/new-sb/canvas-items`)
			return {
				canvasRevision: 0,
				blocks: [block("nen", "entrypoint_1", "entrypoint"), block("neh", "error_handler_1", "error_handler")],
				edges: [],
			};
		if (path === `/v1/projects/${P}/sandboxes/theirs`) throw new Error("Not found.");
		if (path.includes("ephemeral-runs")) return { id: "eph", status: 200, body: "ok" };
		throw new Error(`unexpected ${method} ${path}`);
	};
	const api: AdminApi = {
		get: async (path) => {
			calls.push({ method: "GET", path });
			return answer("GET", path);
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			return answer(method, path);
		},
	};
	return { api, calls };
}

const run = (args: object, api: AdminApi) =>
	copyBlocksTool.call(api, z.object(copyBlocksTool.input).parse({ projectId: P, ...args })) as Promise<any>;
const saved = (calls: Call[]) => calls.find((c) => c.method === "PUT")!;
/** the blocks the save restates because an edge starts there, not copies */
const TARGET_OWN = new Set(["nen", "neh", "sen", "seh", "sjs"]);
const copiesIn = (call: Call) =>
	call.body.changes.blocks.filter((b: any) => !TARGET_OWN.has(b.id));

describe("copy_blocks", () => {
	it("copies a whole route into a new sandbox named after it, with new ids and its edges", async () => {
		const { api, calls } = fakeApi({ middlewares: { before: [{ id: "m" }], after: [] } });
		const result = await run({ from: { kind: "route", id: "r1" }, to: "__new_sandbox__" }, api);

		const create = calls.find((c) => c.method === "POST")!;
		expect(create.body).toEqual({ name: "Orders sandbox" });

		const put = saved(calls);
		expect(put.path).toBe(`/v1/projects/${P}/sandboxes/new-sb/save-canvas?expectedRevision=0`);
		const blocks = copiesIn(put);
		const { edges } = put.body.changes;
		// 4 copies: entrypoint and error handler never travel
		expect(blocks.map((b: any) => b.type).sort()).toEqual(["if", "jsrunner", "response", "response"]);
		const sourceIds = ["en", "eh", "fx", "if", "ok", "no"];
		expect(blocks.some((b: any) => sourceIds.includes(b.id))).toBe(false);
		expect(blocks.find((b: any) => b.type === "jsrunner").data).toEqual({
			value: "return 1",
			blockName: "fetch",
		});
		// the 3 edges between copies, plus the new sandbox's entrypoint to the first block
		expect(edges).toHaveLength(4);
		const jsId = blocks.find((b: any) => b.type === "jsrunner").id;
		const ifId = blocks.find((b: any) => b.type === "if").id;
		expect(edges.some((e: any) => e.from === "nen" && e.to === jsId)).toBe(true);
		expect(edges.some((e: any) => e.from === jsId && e.to === ifId)).toBe(true);
		expect(edges.filter((e: any) => e.from === ifId).map((e: any) => e.fromHandle.split("-").pop()).sort()).toEqual(["failure", "success"]);

		expect(result.target).toEqual({ kind: "sandbox", id: "new-sb", name: "Orders sandbox" });
		expect(Object.keys(result.keys).sort()).toEqual(["if_1", "jsrunner_1", "response_1", "response_2"]);
		expect(result.warnings).toEqual([
			"The route's middlewares are not copied: they are route settings, not blocks.",
			"The route's request schemas are not copied: a sandbox accepts any body, query and params.",
		]);
	});

	it("drops edges to blocks that were not copied, and attaches the copy with connect_from", async () => {
		const { api, calls } = fakeApi();
		await run(
			{
				from: { kind: "route", id: "r1" },
				keys: ["if_1", "response_1"],
				to: { kind: "sandbox", id: "sb1" },
				connect_from: { from: "jsrunner_1" },
			},
			api,
		);
		const put = saved(calls);
		expect(put.path).toBe(`/v1/projects/${P}/sandboxes/sb1/save-canvas?expectedRevision=1`);
		const blocks = copiesIn(put);
		const { edges } = put.body.changes;
		expect(blocks).toHaveLength(2);
		const ifId = blocks.find((b: any) => b.type === "if").id;
		const okId = blocks.find((b: any) => b.type === "response").id;
		// if → response_1 stays; fetch → if (fetch not copied) is gone; if.failure → response_2 is gone
		expect(edges.filter((e: any) => e.from === ifId).map((e: any) => e.to)).toEqual([okId]);
		// the copy hangs off the target's own block, not off the source's
		expect(edges.find((e: any) => e.to === ifId)?.from).toBe("sjs");
		// no sandbox was made for an existing target
		expect(calls.some((c) => c.method === "POST")).toBe(false);
	});

	it("never copies the entrypoint or error handler, even when named", async () => {
		const { api, calls } = fakeApi();
		await run(
			{ from: { kind: "route", id: "r1" }, keys: ["entrypoint_1", "response_1"], to: { kind: "route", id: "r2" } },
			api,
		);
		const types = copiesIn(saved(calls)).map((b: any) => b.type);
		expect(types).toEqual(["response"]);
		await expect(
			run({ from: { kind: "route", id: "r1" }, keys: ["entrypoint_1"], to: { kind: "route", id: "r2" } }, api),
		).rejects.toThrow("Nothing to copy");
	});

	it("moves the copy to position, keeping the blocks' spacing", async () => {
		const { api, calls } = fakeApi();
		await run(
			{ from: { kind: "route", id: "r1" }, keys: ["if_1", "response_1"], to: { kind: "workflow", id: "w1" }, position: { x: 500, y: 40 } },
			api,
		);
		const xs = copiesIn(saved(calls)).map((b: any) => [b.type, b.position]);
		expect(xs).toEqual([
			["if", { x: 500, y: 40 }],
			["response", { x: 600, y: 40 }],
		]);
	});

	it("refuses a source or target in another project, and a key that is not there, and saves nothing", async () => {
		const { api, calls } = fakeApi({ routeProject: OTHER });
		await expect(
			run({ from: { kind: "route", id: "r1" }, to: "__new_sandbox__" }, api),
		).rejects.toThrow("another project");
		await expect(
			run({ from: { kind: "route", id: "r2" }, to: { kind: "route", id: "r1" } }, api),
		).rejects.toThrow("another project");
		expect(calls.some((c) => c.method !== "GET")).toBe(false);

		const mine = fakeApi();
		await expect(
			run({ from: { kind: "route", id: "r1" }, keys: ["db_9"], to: "__new_sandbox__" }, mine.api),
		).rejects.toThrow('No block db_9 on that canvas. Keys: entrypoint_1');
		expect(mine.calls.some((c) => c.method !== "GET")).toBe(false);
	});

	it("reads another person's sandbox as a plain not found", async () => {
		const { api, calls } = fakeApi();
		await expect(
			run({ from: { kind: "sandbox", id: "theirs" }, to: "__new_sandbox__" }, api),
		).rejects.toThrow("Not found");
		expect(calls.some((c) => c.method !== "GET")).toBe(false);
	});

	it("points a fan-out block's order list at the copies", async () => {
		const { api, calls } = fakeApi();
		// the route's canvas swapped for an orchestrator listing two branches
		const canvas = {
			canvasRevision: 1,
			blocks: [
				block("en", "entrypoint_1", "entrypoint"),
				block("or", "orchestrator_1", "orchestrator", { order: ["a", "b"] }),
				block("a", "jsrunner_1", "jsrunner"),
				block("b", "jsrunner_2", "jsrunner"),
			],
			edges: [
				edge("x", "en", "source", "or"),
				edge("y", "or", "orchestrate", "b"),
				edge("z", "or", "orchestrate", "a"),
			],
		};
		const api2: AdminApi = {
			get: async (path) =>
				path.endsWith("/canvas-items") && path.includes("/routes/r1")
					? canvas
					: api.get(path),
			send: api.send,
		};
		await run({ from: { kind: "route", id: "r1" }, to: { kind: "sandbox", id: "sb1" } }, api2);
		const blocks = copiesIn(saved(calls));
		const orchestrator = blocks.find((b: any) => b.type === "orchestrator");
		const jsIds = blocks.filter((b: any) => b.type === "jsrunner").map((b: any) => b.id);
		expect(orchestrator.data.order).toHaveLength(2);
		expect([...orchestrator.data.order].sort()).toEqual([...jsIds].sort());
		expect(orchestrator.data.order[0]).toBe(jsIds[0]);
	});

	it("deletes the sandbox it made when the save is refused", async () => {
		const { api, calls } = fakeApi({ saveFails: "Invalid input: boom" });
		await expect(
			run({ from: { kind: "route", id: "r1" }, to: "__new_sandbox__" }, api),
		).rejects.toThrow("boom");
		expect(calls.at(-1)).toMatchObject({
			method: "DELETE",
			path: `/v1/projects/${P}/sandboxes/new-sb`,
		});
	});

	it("only asks to write, and answers to creators", () => {
		expect(copyBlocksTool.annotations?.readOnlyHint).toBe(false);
		expect(copyBlocksTool.role).toBe("creator");
	});
});

describe("run_blocks with from", () => {
	const runBlocks = sandboxTools.find((t) => t.name === "run_blocks")!;
	const call = (args: object, api: AdminApi) =>
		runBlocks.call(api, z.object(runBlocks.input).parse({ projectId: P, ...args })) as Promise<any>;

	it("sends the saved canvas as blocks and edges by key, entry block first, and saves nothing", async () => {
		const { api, calls } = fakeApi();
		const result = await call({ from: { kind: "route", id: "r1" }, input: { id: 1 } }, api);
		const post = calls.find((c) => c.path.includes("ephemeral-runs"))!;
		expect(post.path).toBe(`/v1/projects/${P}/ephemeral-runs`);
		expect(post.body.blocks.map((b: any) => b.ref)).toEqual([
			"jsrunner_1",
			"if_1",
			"response_1",
			"response_2",
		]);
		expect(post.body.edges).toEqual([
			{ from: "jsrunner_1", to: "if_1", handle: "source" },
			{ from: "if_1", to: "response_1", handle: "success" },
			{ from: "if_1", to: "response_2", handle: "failure" },
		]);
		expect(post.body.body).toEqual({ id: 1 });
		expect(post.body.from).toBeUndefined();
		expect(calls.filter((c) => c.method === "PUT" || c.method === "DELETE")).toEqual([]);
		expect(result.warnings).toHaveLength(1);
	});

	it("runs only the keys it is given, and wants exactly one of blocks and from", async () => {
		const { api, calls } = fakeApi();
		await call({ from: { kind: "route", id: "r1" }, keys: ["if_1", "response_1"] }, api);
		const post = calls.find((c) => c.path.includes("ephemeral-runs"))!;
		expect(post.body.blocks.map((b: any) => b.ref)).toEqual(["if_1", "response_1"]);
		expect(post.body.edges).toEqual([{ from: "if_1", to: "response_1", handle: "success" }]);

		await expect(call({}, api)).rejects.toThrow("either blocks or from");
		await expect(
			call({ from: { kind: "route", id: "r1" }, blocks: [{ ref: "a", type: "jsrunner" }] }, api),
		).rejects.toThrow("either blocks or from");
	});
});
