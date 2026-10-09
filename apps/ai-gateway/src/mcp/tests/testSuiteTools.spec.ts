import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { testSuiteTools } from "../testSuiteTools";

type Call = { method: string; path: string; body?: unknown };

/** A fake admin API: records each call; `fail` makes a PUT throw like a 400. */
function fakeApi(fail = false) {
	const calls: Call[] = [];
	const api: AdminApi = {
		get: async (path) => {
			calls.push({ method: "GET", path });
		},
		send: async (method, path, body) => {
			calls.push({ method, path, body });
			if (fail && method === "PUT") throw new Error("Invalid input: Block b9 is not on this suite's route");
			return { id: "s1", droppedHooks: ["Load user"] };
		},
	};
	return { api, calls };
}

const tool = (name: string) => testSuiteTools.find((t) => t.name === name)!;
const parse = (name: string, args: object) => z.object(tool(name).input).safeParse(args);
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

const statusCheck = { target: "status", operator: "eq", expectedValue: "200" };

describe("test suite tools", () => {
	it("all need the creator role; delete is destructive, save and clone are not", () => {
		for (const t of testSuiteTools) expect(t.role).toBe("creator");
		expect(tool("delete_test_suite").annotations?.destructiveHint).toBe(true);
		expect(tool("save_test_suite").annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
		expect(tool("clone_test_suite").annotations?.destructiveHint).toBe(false);
	});

	it("save_test_suite accepts a full route suite and a workflow suite", () => {
		const route = parse("save_test_suite", {
			targetType: "route",
			targetId: "r1",
			name: "Returns the user",
			routeParams: { id: "42" },
			headers: { Authorization: "Bearer test" },
			assertions: [
				statusCheck,
				{ target: "body", propertyPath: "user.name", operator: "eq", expectedValue: "Ada" },
				{ target: "customJs", customJs: "t.expect(fluxify.response.status).toBe(200);" },
			],
			hooks: [{ blockId: "b1", onBefore: { kind: "json", value: '{"id":42}' } }],
			setupBlockId: "c1",
			appConfigOverrides: [{ key: "DB_URL", value: "postgres://test" }],
		});
		expect(route.success).toBe(true);
		const workflow = parse("save_test_suite", {
			testSuiteId: "s1",
			input: { source: "raw", mode: "cases", raw: [{ name: "paid", input: { id: 1 } }, 7] },
			assertions: [{ target: "successful", operator: "true" }],
		});
		expect(workflow.success).toBe(true);
	});

	it("save_test_suite rejects a wrong shape with the field that is wrong", () => {
		const bad = (args: object) => {
			const r = parse("save_test_suite", args);
			expect(r.success).toBe(false);
			return JSON.stringify(r.error?.issues);
		};
		expect(bad({ assertions: [{ target: "status", operator: "contains", expectedValue: "2" }] })).toContain(
			"not allowed for target 'status'",
		);
		expect(bad({ assertions: [{ target: "body", operator: "eq" }] })).toContain("Expected value is required");
		expect(bad({ assertions: [{ target: "nope", operator: "eq" }] })).toContain("target");
		expect(bad({ hooks: [{ blockId: "b1", onBefore: { kind: "json", value: "{not json" } }] })).toContain(
			"Invalid JSON",
		);
		expect(bad({ input: { source: "raw", mode: "cases", raw: { id: 1 } } })).toContain("Cases must be a list");
		expect(bad({ targetType: "middleware" })).toContain("targetType");
	});

	it("save_test_suite creates on the target, then sets the rest", async () => {
		const { api, calls } = fakeApi();
		const result = await run(
			"save_test_suite",
			{ targetType: "route", targetId: "r1", name: "ok", routeParams: { id: "1" }, assertions: [statusCheck] },
			api,
		);
		expect(result).toEqual({ id: "s1" });
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/test-suites/route/r1", body: { name: "ok", description: "" } },
			{
				method: "PUT",
				path: "/v1/test-suites/s1",
				body: { routeParams: { id: "1" }, assertions: [statusCheck] },
			},
		]);
	});

	it("save_test_suite with only a name and description is one call", async () => {
		const { api, calls } = fakeApi();
		await run("save_test_suite", { targetType: "workflow", targetId: "w1", name: "n", description: "d" }, api);
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/test-suites/workflow/w1", body: { name: "n", description: "d" } },
		]);
	});

	it("save_test_suite updates with only what changes, never the project", async () => {
		const { api, calls } = fakeApi();
		await run("save_test_suite", { testSuiteId: "s1", targetId: "ignored", runAlone: true }, api);
		expect(calls).toEqual([{ method: "PUT", path: "/v1/test-suites/s1", body: { runAlone: true } }]);
	});

	it("save_test_suite says what a create needs, and removes a half-made suite", async () => {
		const { api, calls } = fakeApi(true);
		expect(run("save_test_suite", { name: "x" }, api)).rejects.toThrow("pass targetType, targetId and name");
		await expect(
			run("save_test_suite", { targetType: "route", targetId: "r1", name: "x", hooks: [] }, api),
		).rejects.toThrow("not on this suite's route");
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"POST /v1/test-suites/route/r1",
			"PUT /v1/test-suites/s1",
			"DELETE /v1/test-suites/s1",
		]);
	});

	it("validate_test_suite posts the sample, or an empty body for the last run", async () => {
		const { api, calls } = fakeApi();
		await run("validate_test_suite", { testSuiteId: "s1" }, api);
		await run("validate_test_suite", { testSuiteId: "s1", sample: { status: 400, body: { message: "x" } } }, api);
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/test-suites/s1/validate", body: {} },
			{
				method: "POST",
				path: "/v1/test-suites/s1/validate",
				body: { sample: { status: 400, body: { message: "x" } } },
			},
		]);
	});

	it("delete_test_suite deletes by id", async () => {
		const { api, calls } = fakeApi();
		expect(await run("delete_test_suite", { testSuiteId: "s1" }, api)).toEqual({ deleted: "s1" });
		expect(calls).toEqual([{ method: "DELETE", path: "/v1/test-suites/s1", body: undefined }]);
		expect(parse("delete_test_suite", {}).success).toBe(false);
	});

	it("clone_test_suite posts the target and returns the copy's id and dropped hooks", async () => {
		const { api, calls } = fakeApi();
		expect(await run("clone_test_suite", { testSuiteId: "s0", kind: "workflow", targetId: "w2" }, api)).toEqual({
			id: "s1",
			droppedHooks: ["Load user"],
		});
		expect(calls).toEqual([
			{ method: "POST", path: "/v1/test-suites/s0/clone", body: { kind: "workflow", targetId: "w2" } },
		]);
		expect(parse("clone_test_suite", { testSuiteId: "s0", kind: "trigger", targetId: "x" }).success).toBe(false);
	});
});
