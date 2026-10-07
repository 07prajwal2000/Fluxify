import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { optionalFields, writeTools } from "../writeTools";

type Call = { method: string; path: string; body?: unknown };

/** A fake admin API: records each call and answers from `gets` / `{ id }`. */
function fakeApi(gets: Record<string, unknown> = {}) {
	const calls: Call[] = [];
	const api: AdminApi = {
		get: async (path) => {
			calls.push({ method: "GET", path });
			return gets[path];
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			return { id: "new-id", warnings: [], secret: "never echoed" };
		},
	};
	return { api, calls };
}

/** Trigger ids are uuidv7, and the server schema the tool reuses checks it. */
const P = "019a0000-0000-7000-8000-000000000000";

const tool = (name: string) => writeTools.find((t) => t.name === name)!;

/** Parses args the way the MCP server does before `call` sees them. */
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

describe("optionalFields", () => {
	it("drops defaults, so an update never resets a field it did not name", () => {
		const shape = optionalFields({ n: z.number().default(1), s: z.string().optional() });
		expect(z.object(shape).parse({})).toEqual({});
		const hidden = z.object(optionalFields({ a: z.array(z.string()).default([]).optional().nullable() }));
		expect(hidden.parse({})).toEqual({});
		expect(hidden.parse({ a: null })).toEqual({ a: null });
	});
});

describe("write tools", () => {
	it("deletes are destructive, saves are not, tests are read-only and open-world", () => {
		for (const t of writeTools) {
			if (t.name.startsWith("delete_")) expect(t.annotations?.destructiveHint).toBe(true);
			if (t.name.startsWith("save_")) expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
		}
		expect(tool("test_integration_connection").annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
	});

	it("save_trigger creates without an id and patches only the given fields with one", async () => {
		const { api, calls } = fakeApi();
		expect(await run("save_trigger", { projectId: P, name: "tick", type: "internal" }, api)).toEqual({
			id: "new-id",
			warnings: [],
		});
		await run("save_trigger", { triggerId: "t1", projectId: P, type: "internal", active: false }, api);
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/triggers", body: { projectId: P, type: "internal", name: "tick" } },
			{ method: "PATCH", path: "/v1/triggers/t1", body: { active: false } },
		]);
	});

	it("save_custom_block never sends name or usage on update", async () => {
		const { api, calls } = fakeApi();
		await run("save_custom_block", { customBlockId: "c1", name: "x", usage: "flow", label: "X" }, api);
		expect(calls).toEqual([{ method: "PUT", path: "/v1/custom-blocks/c1", body: { label: "X" } }]);
	});

	it("save_app_config fills the fields an update needs and keeps the value when none is given", async () => {
		const cur = { keyName: "GREETING", description: "d", isEncrypted: true, encodingType: "hex", value: "****" };
		const { api, calls } = fakeApi({ "/v1/p/app-config/7": cur });
		expect(await run("save_app_config", { projectId: "p", appConfigId: 7, description: "new" }, api)).toEqual({
			id: "new-id",
		});
		expect(calls[1]).toEqual({
			method: "PUT",
			path: "/v1/p/app-config/7",
			body: { keyName: "GREETING", description: "new", isEncrypted: true, encodingType: "hex" },
		});
	});

	it("save_integration returns only the id, never the config", async () => {
		const cur = { name: "cache", config: { source: "url", url: "cfg:REDIS_URL" } };
		const { api, calls } = fakeApi({ "/v1/p/integrations/i1": cur });
		expect(await run("save_integration", { projectId: "p", integrationId: "i1", name: "kv" }, api)).toEqual({
			id: "new-id",
		});
		expect(calls[1]).toEqual({
			method: "PUT",
			path: "/v1/p/integrations/i1",
			body: { name: "kv", config: cur.config },
		});
	});

	it("test_integration_connection tests a saved one by id, or a config before saving", async () => {
		const { api, calls } = fakeApi();
		await run("test_integration_connection", { projectId: "p", integrationId: "i1" }, api);
		await run("test_integration_connection", { projectId: "p", group: "kv", variant: "Redis", config: {} }, api);
		expect(calls).toEqual([
			{ method: "GET", path: "/v1/p/integrations/test-existing-connection/i1" },
			{
				method: "POST",
				path: "/v1/p/integrations/test-connection",
				body: { group: "kv", variant: "Redis", config: {} },
			},
		]);
	});
});
