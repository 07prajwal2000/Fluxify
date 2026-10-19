import { describe, expect, it } from "bun:test";
import { reachabilityIssues } from "../reachability";
import type { RulesInput } from "../rules";

const block = (id: string, type: string) => ({ id, key: `${type}_1`, type, data: {} });
/** a block named by its id, e.g. `if` -> key `if_1` */
const run = (kind: RulesInput["kind"], types: string[], edges: [string, string, string?][]) =>
	reachabilityIssues({
		kind,
		usageOf: new Map(),
		blocks: types.map((t) => block(t, t)),
		edges: edges.map(([from, to, h]) => ({ from, to, fromHandle: h ? `${from}-${h}` : `${from}-source` })),
	}).map((i) => i.message);

describe("canvas reachability (#704)", () => {
	it("is quiet for a wired route", () => {
		expect(run("route", ["entrypoint", "response"], [["entrypoint", "response"]])).toEqual([]);
	});

	it("warns when no path leads to a response", () => {
		const out = run("route", ["entrypoint", "response", "jsrunner"], [["entrypoint", "jsrunner"]]);
		expect(out).toEqual([
			"response_1 is not connected to the flow, so it never runs.",
			"No path from entrypoint to a response block: the route returns the default response (NO RESULT).",
		]);
	});

	it("names an orphan by key, never a sticky note or the error handler", () => {
		const out = run(
			"route",
			["entrypoint", "response", "jsrunner", "sticky_note", "error_handler"],
			[["entrypoint", "response"]],
		);
		expect(out).toEqual(["jsrunner_1 is not connected to the flow, so it never runs."]);
	});

	it("warns about an open if branch", () => {
		const out = run("route", ["entrypoint", "if", "response"], [
			["entrypoint", "if"],
			["if", "response", "success"],
		]);
		expect(out).toEqual(["if_1.failure is not connected: the flow stops there with no response."]);
	});

	it("keeps quiet for handles that are open by design", () => {
		// retry failure/success open, loop body and orchestrate branch ends open
		const types = ["entrypoint", "retry", "jsrunner", "foreachloop", "response"];
		const out = run("route", types, [
			["entrypoint", "retry"],
			["retry", "jsrunner", "executor"],
			["retry", "foreachloop", "success"],
			["foreachloop", "response", "source"],
		]);
		expect(out).toEqual([]);
		// an if inside a loop body may end the iteration
		expect(
			run("route", ["entrypoint", "foreachloop", "if", "response"], [
				["entrypoint", "foreachloop"],
				["foreachloop", "if", "executor"],
				["foreachloop", "response", "source"],
			]),
		).toEqual([]);
	});

	it("workflows and custom blocks only warn about unreachable blocks", () => {
		for (const kind of ["workflow", "custom_block"] as const) {
			expect(run(kind, ["entrypoint", "if"], [["entrypoint", "if"]])).toEqual([]);
			expect(run(kind, ["entrypoint", "jsrunner"], [])).toEqual([
				"jsrunner_1 is not connected to the flow, so it never runs.",
			]);
		}
	});

	it("falls back to the id when a block has no key yet and skips a canvas with no entrypoint", () => {
		const blocks = [{ id: "x", type: "jsrunner", data: {} }, { id: "e", type: "entrypoint", data: {} }];
		const [issue] = reachabilityIssues({ kind: "workflow", usageOf: new Map(), blocks, edges: [] });
		expect(issue).toMatchObject({ blockId: "x", message: "x is not connected to the flow, so it never runs." });
		expect(run("route", ["jsrunner"], [])).toEqual([]);
	});
});

describe("canvas reachability with a handle spec (R2 #848)", () => {
	const specs = {
		agent: {
			in: ["target"],
			out: ["success", "failure"] as ["success", "failure"],
			body: [
				{ name: "tools", corner: "bottom-left" as const, allowMultiple: true },
				{ name: "model", corner: "top-right" as const },
			],
		},
	};
	const runSpec = (edges: [string, string, string?][]) =>
		reachabilityIssues(
			{
				kind: "route",
				usageOf: new Map(),
				blocks: ["entrypoint", "agent", "response", "jsrunner"].map((t) => block(t, t)),
				edges: edges.map(([from, to, h]) => ({ from, to, fromHandle: `${from}-${h ?? "source"}` })),
			},
			specs,
		).map((i) => i.message);

	it("treats body handles as bodies and warns on an open spec'd branch", () => {
		expect(
			runSpec([
				["entrypoint", "agent"],
				["agent", "jsrunner", "tools"],
				["agent", "response", "success"],
			]),
		).toEqual(["agent_1.failure is not connected: the flow stops there with no response."]);
	});

	it("does not follow a body chain to the response for the main flow", () => {
		expect(
			runSpec([
				["entrypoint", "agent"],
				["agent", "response", "model"],
				["agent", "jsrunner", "success"],
				["agent", "jsrunner", "failure"],
			]),
		).toEqual([]);
	});
});
