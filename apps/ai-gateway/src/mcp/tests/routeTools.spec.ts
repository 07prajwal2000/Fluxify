import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { MAX_RESPONSE_CHARS, routeTools, truncate } from "../routeTools";
import { readTools } from "../tools";

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

	it("save_route with middlewares creates, then sets both lists in order", async () => {
		const { api, calls } = fakeApi();
		const input = { projectId: P, name: "priv", path: "/p", method: "GET" };
		await run("save_route", { ...input, middlewares: { before: ["m2", "m1"], after: ["m3"] } }, api);
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/routes", body: input },
			{ method: "PUT", path: "/v1/routes/new-id/middlewares", body: { before: ["m2", "m1"], after: ["m3"] } },
		]);
		expect(tool("save_route").role).toBe("creator");
		expect(tool("save_route").description).toContain("list_middlewares");
	});

	it("save_route keeps the side it is not given and skips an empty patch", async () => {
		const calls: Call[] = [];
		const api: AdminApi = {
			get: async (path) => {
				calls.push({ method: "GET", path });
				return { before: [{ id: "b1", name: "b" }], after: [{ id: "a1", name: "a" }] };
			},
			send: async (method, path, body) => {
				calls.push({ method, path, body });
				return { id: "r1" };
			},
		};
		await run("save_route", { routeId: "r1", middlewares: { before: [] } }, api);
		await run("save_route", { routeId: "r1", active: true, middlewares: { after: ["a2", "a1"] } }, api);
		expect(calls).toEqual([
			{ method: "GET", path: "/v1/routes/r1/middlewares" },
			{ method: "PUT", path: "/v1/routes/r1/middlewares", body: { before: [], after: ["a1"] } },
			{ method: "PATCH", path: "/v1/routes/partial/r1", body: { active: true } },
			{ method: "GET", path: "/v1/routes/r1/middlewares" },
			{ method: "PUT", path: "/v1/routes/r1/middlewares", body: { before: ["b1"], after: ["a2", "a1"] } },
		]);
	});

	it("save_route rejects a middlewares shape it does not know", () => {
		const input = z.object(tool("save_route").input);
		expect(input.safeParse({ routeId: "r1", middlewares: { before: "m1" } }).success).toBe(false);
		expect(input.safeParse({ routeId: "r1", middlewares: ["m1"] }).success).toBe(false);
	});

	it("get_route shows the attached middlewares by id and name", async () => {
		const getRoute = readTools.find((t) => t.name === "get_route")!;
		const api: AdminApi = {
			get: async (path) =>
				path.endsWith("/middlewares")
					? { before: [{ id: "m1", name: "auth", description: null }], after: [] }
					: { id: "r1", name: "p", method: "GET", path: "/p", createdAt: "x" },
			send: async () => ({}),
		};
		expect(await getRoute.call(api, { routeId: "r1" })).toEqual({
			id: "r1",
			name: "p",
			method: "GET",
			path: "/p",
			middlewares: { before: [{ id: "m1", name: "auth" }], after: [] },
		});
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
			{
				method: "POST",
				path: "/v1/routes/r1/call",
				body: { params: { id: "7" }, body: { a: 1 }, debug: true },
			},
		]);
		expect(result.status).toBe(200);
		expect(result.body).toEndWith(`(truncated, ${big.length} characters in all)`);
		expect(result).not.toHaveProperty("error");
		expect(truncate({ ok: true })).toEqual({ ok: true });
	});

	it("call_route returns a failed run's debug error as error", async () => {
		const debugError = {
			block: { id: "b7", type: "db_native", name: "Load user" },
			message: "failed to execute native db block",
			detail: 'PostgresError: column "emial" does not exist',
		};
		const { api } = fakeApi({
			status: 500,
			contentType: "application/json",
			body: { error: "Error: failed to execute native db block" },
			debugError,
		});
		expect(await run("call_route", { routeId: "r1" }, api)).toEqual({
			status: 500,
			contentType: "application/json",
			body: { error: "Error: failed to execute native db block" },
			error: debugError,
		});
		expect(tool("call_route").description).toContain("agents/recipes/debug-and-fix");
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
