import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { canvasTools } from "../canvasTools";
import { MCP_INSTRUCTIONS } from "../instructions";
import { sandboxTools } from "../sandboxTools";

type Call = { method: string; path: string; body?: unknown };

function fakeApi(answer: (path: string) => unknown) {
	const calls: Call[] = [];
	const api: AdminApi = {
		get: async (path) => {
			calls.push({ method: "GET", path });
			return answer(path);
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			return answer(path);
		},
	};
	return { api, calls };
}

const P = "019a0000-0000-7000-8000-000000000000";
const S = "019a0000-0000-7000-8000-00000000000s";
const all = [...sandboxTools, ...canvasTools];
const tool = (name: string) => all.find((t) => t.name === name)!;
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

describe("sandbox tools", () => {
	it("go through the owner-checked sandbox endpoints", async () => {
		const { api, calls } = fakeApi(() => ({ data: [{ id: S, name: "x", projectId: P }], id: S }));
		await run("list_sandboxes", { projectId: P }, api);
		await run("get_sandbox", { projectId: P, sandboxId: S }, api);
		await run("create_sandbox", { projectId: P, name: "peek" }, api);
		await run("delete_sandbox", { projectId: P, sandboxId: S }, api);
		await run("run_sandbox", { projectId: P, sandboxId: S, payload: { n: 1 } }, api);
		const base = `/v1/projects/${P}/sandboxes`;
		expect(calls).toEqual([
			{ method: "GET", path: base },
			{ method: "GET", path: `${base}/${S}` },
			{ method: "POST", path: base, body: { name: "peek" } },
			{ method: "DELETE", path: `${base}/${S}`, body: undefined },
			{ method: "POST", path: `${base}/${S}/run`, body: { payload: { n: 1 } } },
		]);
		expect(tool("delete_sandbox").annotations?.destructiveHint).toBe(true);
		expect(tool("call_sandbox").annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });
	});

	it("call_sandbox asks the server to call, never holds the token, and names failed blocks by key", async () => {
		const { api, calls } = fakeApi((path) =>
			path.endsWith("/canvas-items")
				? { blocks: [{ id: "b1", key: "db_native_1" }] }
				: {
						status: 500,
						body: "x".repeat(20_000),
						runId: "run-1",
						recording: "/v1/…/runs/run-1",
						debugError: { block: { id: "b1", type: "db_native" }, message: "boom" },
						debugTrace: { spans: [{ blockId: "b1", blockType: "db_native", outcome: "failure", ms: 2, error: "boom" }] },
					},
		);
		const result: any = await run(
			"call_sandbox",
			{ projectId: P, sandboxId: S, method: "POST", path: "/peek", body: { a: 1 } },
			api,
		);
		expect(calls[0]).toEqual({
			method: "POST",
			path: `/v1/projects/${P}/sandboxes/${S}/call`,
			body: { method: "POST", path: "/peek", body: { a: 1 }, debug: true },
		});
		// the sandbox's own canvas, read for block keys
		expect(calls[1]).toEqual({ method: "GET", path: `/v1/projects/${P}/sandboxes/${S}/canvas-items` });
		expect(JSON.stringify(calls[0])).not.toContain("token");
		expect(result).toMatchObject({
			status: 500,
			runId: "run-1",
			error: { block: { key: "db_native_1", type: "db_native" }, message: "boom" },
			trace: ["db_native_1 (db_native) ERROR 2ms: boom"],
		});
		expect(result.body).toContain("truncated");
	});

	it("get_canvas and edit_canvas reach a sandbox under its project, and need the project", async () => {
		const { api, calls } = fakeApi((path) =>
			path.includes("save-canvas")
				? { canvasRevision: 2, newKeys: {} }
				: { canvasRevision: 1, blocks: [{ id: "e1", key: "entrypoint_1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } }], edges: [] },
		);
		const target = { kind: "sandbox", id: S, projectId: P };
		await run("get_canvas", { target }, api);
		await run("edit_canvas", { target, revision: 1, ops: [] }, api);
		expect(calls.map((c) => c.path)).toEqual([
			`/v1/projects/${P}/sandboxes/${S}/canvas-items`,
			`/v1/projects/${P}/sandboxes/${S}/canvas-items`,
			`/v1/projects/${P}/sandboxes/${S}/save-canvas?expectedRevision=1&dryRun=true`,
		]);
		await expect(run("get_canvas", { target: { kind: "sandbox", id: S } }, api)).rejects.toThrow(
			"A sandbox target needs projectId",
		);
	});

	it("the server instructions say what a sandbox is", () => {
		expect(MCP_INSTRUCTIONS).toContain("- Sandbox:");
	});
});

describe("run_blocks", () => {
	it("posts the blocks to the ephemeral endpoint with debug on, and names things by ref", async () => {
		const { api, calls } = fakeApi(() => ({
			id: "eph_1",
			status: 500,
			body: "x".repeat(20_000),
			durationMs: 12,
			debugError: { block: { id: "calc", type: "jsrunner" }, message: "boom", stack: "at calc" },
			debugTrace: {
				spans: [{ blockId: "calc", blockType: "jsrunner", outcome: "failure", ms: 2, error: "boom" }],
			},
		}));
		const result: any = await run(
			"run_blocks",
			{
				projectId: P,
				blocks: [{ ref: "calc", type: "jsrunner", data: { value: "throw new Error('boom')" } }],
				edges: [],
				input: { n: 1 },
				timeoutSeconds: 5,
			},
			api,
		);
		expect(calls).toEqual([
			{
				method: "POST",
				path: `/v1/projects/${P}/ephemeral-runs`,
				body: {
					blocks: [{ ref: "calc", type: "jsrunner", data: { value: "throw new Error('boom')" } }],
					edges: [],
					body: { n: 1 },
					timeoutSeconds: 5,
				},
			},
		]);
		expect(result).toMatchObject({
			id: "eph_1",
			status: 500,
			error: { block: { key: "calc", type: "jsrunner" }, message: "boom", stack: "at calc" },
			trace: ["calc (jsrunner) ERROR 2ms: boom"],
		});
		expect(result.body).toContain("truncated");
		expect(result.debugError).toBeUndefined();
	});

	it("is a creator's, runs user code for real, and is described as keeping nothing", () => {
		const t = tool("run_blocks");
		expect(t.role).toBe("creator");
		expect(t.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });
		expect(t.description).toContain("leave nothing behind");
		expect(MCP_INSTRUCTIONS).toContain("run_blocks");
	});
});
