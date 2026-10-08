import { describe, expect, it } from "bun:test";
import { outcome } from "./guards";
import { looping, run, type Step } from "./guards.fixture";

const route = (status: number, body: unknown = "x") => (n: string) =>
	n === "call_route" ? { status, body } : { version: 2 };
const edit = (ops: unknown[]): Step => ["edit_canvas", { ops }];
const call = (input: object = {}): Step => ["call_route", { routeId: "r1", ...input }];

describe("progress resets the repeat count", () => {
	it("an edit → call_route 200 loop never stops", async () => {
		const calls = Array.from({ length: 10 }, () => [edit([]), call()]).flat();
		const r = await run(calls, { respond: route(200) });
		expect(r.prompts).toHaveLength(21);
		expect(looping(r).some(Boolean)).toBe(false);
		expect(r.stopped).toBeUndefined();
	});

	it("call_route 500 with the same error stops at 5 even with different args", async () => {
		const calls = Array.from({ length: 6 }, (_, i) => call({ query: { i: String(i) } }));
		const r = await run(calls, { respond: route(500, { error: "db down" }) });
		expect(r.stopped).toEqual({ kind: "repeat", tool: "call_route" });
		expect(r.prompts).toHaveLength(5);
		expect(r.results[2]).toContain("You are looping");
	});

	it("a different call_route error counts separately", () => {
		const a = outcome("call_route", { routeId: "r1" }, { status: 500, body: { error: "db down" } });
		const b = outcome("call_route", { routeId: "r1" }, { status: 500, body: { error: "timeout" } });
		expect(a).toEqual({ kind: "failure", why: 'r1 status 500 {"error":"db down"}' });
		expect(a).not.toEqual(b);
		expect(outcome("call_route", { routeId: "r1" }, { status: 201 })).toEqual({ kind: "progress" });
	});

	it("edit_canvas with warnings is a failure and does not reset", async () => {
		const issues = [{ severity: "warning", message: "response block has no status" }];
		const calls = Array.from({ length: 6 }, (_, i) => edit([i]));
		const r = await run(calls, { respond: () => ({ version: 3, issues }) });
		expect(r.stopped).toEqual({ kind: "repeat", tool: "edit_canvas" });
		expect(r.prompts).toHaveLength(5);
	});

	it("5 identical get_canvas with only failing writes between still stop", async () => {
		let n = 0;
		const respond = (name: string) => {
			if (name === "save_route") throw new Error(`bad ${n++}`);
			return "canvas";
		};
		const calls = Array.from({ length: 6 }, (_, i) => [{ id: "r1" }, ["save_route", { i }] as Step]).flat();
		const r = await run(calls, { respond });
		expect(r.stopped).toEqual({ kind: "repeat", tool: "get_canvas" });
		expect(r.prompts).toHaveLength(9);
	});

	it("a successful write in between resets the count", async () => {
		const calls = Array.from({ length: 6 }, (_, i) => [{ id: "r1" }, { id: "r1" }, ["save_route", { i }] as Step]).flat();
		const r = await run(calls);
		expect(r.stopped).toBeUndefined();
		expect(looping(r).some(Boolean)).toBe(false);
	});

	it("a test run with failing cases is a failure; a pending one and reads are neutral", () => {
		expect(outcome("run_test_suite", {}, { status: "failed", failedCount: 2 })).toEqual({ kind: "failure", why: "2 failing cases" });
		expect(outcome("run_test_suite", {}, { status: "running" })).toEqual({ kind: "neutral" });
		expect(outcome("run_test_suite", {}, { status: "passed", failedCount: 0 })).toEqual({ kind: "progress" });
		expect(outcome("search_docs", {}, ["hit"])).toEqual({ kind: "neutral" });
		expect(outcome("get", {}, undefined, new Error("500"))).toEqual({ kind: "failure", why: "500" });
	});
});
