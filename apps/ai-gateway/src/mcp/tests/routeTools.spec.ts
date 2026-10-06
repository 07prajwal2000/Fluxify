import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { MAX_RESPONSE_CHARS, routeTools, truncate } from "../routeTools";

type Call = { method: string; path: string; body?: unknown };

function fakeApi(answer: unknown = { id: "new-id" }) {
	const calls: Call[] = [];
	const api: AdminApi = {
		get: async (path) => {
			calls.push({ method: "GET", path });
			return answer;
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			return answer;
		},
	};
	return { api, calls };
}

const P = "019a0000-0000-7000-8000-000000000000";
const tool = (name: string) => routeTools.find((t) => t.name === name)!;
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

describe("route and workflow tools", () => {
	it("call_route is destructive, open-world and says it is real", () => {
		expect(tool("call_route").annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });
		expect(tool("call_route").description).toContain("REAL");
		expect(tool("call_route").role).toBe("creator");
		expect(tool("delete_route").annotations?.destructiveHint).toBe(true);
		expect(tool("delete_workflow").annotations?.destructiveHint).toBe(true);
	});

	it("save_route posts a create and patches only the given fields on update", async () => {
		const { api, calls } = fakeApi();
		expect(
			await run("save_route", { projectId: P, name: "users", path: "/users", method: "GET" }, api),
		).toEqual({ id: "new-id" });
		await run("save_route", { routeId: "r1", projectId: P, active: false }, api);
		expect(calls).toEqual([
			{
				method: "POST",
				path: "/v1/routes",
				body: { projectId: P, name: "users", path: "/users", method: "GET" },
			},
			{ method: "PATCH", path: "/v1/routes/partial/r1", body: { active: false } },
		]);
	});

	it("save_workflow never sends projectId on update", async () => {
		const { api, calls } = fakeApi();
		await run("save_workflow", { workflowId: "w1", projectId: P, description: "d" }, api);
		expect(calls).toEqual([{ method: "PATCH", path: "/v1/workflows/w1", body: { description: "d" } }]);
	});

	it("call_route sends the request and cuts a huge body", async () => {
		const big = "x".repeat(MAX_RESPONSE_CHARS + 5);
		const { api, calls } = fakeApi({ status: 200, contentType: "text/plain", body: big });
		const result: any = await run(
			"call_route",
			{ routeId: "r1", params: { id: "7" }, body: { a: 1 } },
			api,
		);
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/routes/r1/call", body: { params: { id: "7" }, body: { a: 1 } } },
		]);
		expect(result.status).toBe(200);
		expect(result.body).toEndWith(`(truncated, ${big.length} characters in all)`);
		expect(truncate({ ok: true })).toEqual({ ok: true });
	});

	it("get_integration_schema shows required fields and defaults, and reads no API", async () => {
		const { api, calls } = fakeApi();
		const result: any = await run("get_integration_schema", { group: "database", variant: "PostgreSQL" }, api);
		expect(result.config).toContain("host: string;");
		expect(result.config).toContain('source: "url";');
		expect(result.config).toContain("maxConnections?: number;");
		expect(result.defaults).toMatchObject({ dbType: "PostgreSQL", source: "credentials" });
		expect(await run("get_integration_schema", { group: "kv", variant: "Nope" }, api)).toContain(
			"Unknown variant",
		);
		expect(calls).toEqual([]);
	});
});
