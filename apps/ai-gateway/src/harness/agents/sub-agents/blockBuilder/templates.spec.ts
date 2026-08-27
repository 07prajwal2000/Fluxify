import { describe, expect, it } from "bun:test";
import { AgentNode, type SubAgentResult, type Task } from "../../../types";
import { staticResponseTemplate } from "./templates";

const task = (description: string): Task => ({
	id: "t2",
	title: "Build the route canvas",
	description,
	dependsOnAgentId: ["t1"],
	status: "pending",
	assignedAgentNode: AgentNode.BLOCK_BUILDER,
});

/** The route config task this canvas task hangs off, creating a new route. */
const created: Record<string, SubAgentResult> = {
	t1: { action: "create", routeId: "route-1", data: { path: "/health" } },
};

const match = (description: string, results = created) =>
	staticResponseTemplate(task(description), results, []);

describe("staticResponseTemplate", () => {
	it("wires entrypoint to a fixed body to a response", () => {
		const result = match('Return {"status":"ok"} to the caller.');
		expect(result?.targetId).toBe("route-1");
		expect(result?.blocks.map((b) => b.blockType)).toEqual([
			"entrypoint",
			"jsrunner",
			"response",
		]);
		expect(result?.blocks[1].data).toEqual({ value: 'return {"status":"ok"};' });
		expect(result?.blocks[2].data).toEqual({ httpCode: "200" });
		// Each block feeds exactly the next one; the response terminates.
		expect(result?.blocks.map((b) => b.connections?.length)).toEqual([1, 1, 0]);
	});

	it("uses the status code the task names", () => {
		expect(match('Respond 201 with {"created":true}')?.blocks[2].data).toEqual({
			httpCode: "201",
		});
	});

	// A brace inside a string value used to end the literal early, which would
	// have shipped a route returning a JSON fragment.
	it("reads a body whose values contain braces", () => {
		expect(match('Return {"tpl":"a {b} c"} always.')?.blocks[1].data).toEqual({
			value: 'return {"tpl":"a {b} c"};',
		});
	});

	it("declines a canvas that needs more than a fixed body", () => {
		expect(match('Read the users table and return {"user":null}')).toBeNull();
		expect(match('Return {"id":1} for the id param')).toBeNull();
		expect(match('Return {"ok":true} and log the call')).toBeNull();
	});

	// Two codes is a branch, two literals is a choice of shape — either way the
	// answer depends on something a template cannot see.
	it("declines an ambiguous body or status", () => {
		expect(match('Return {"ok":true} on 200, {"ok":false} on 500')).toBeNull();
		expect(match('Return {"ok":true} with 200 or 404')).toBeNull();
	});

	it("declines a route that already exists", () => {
		const existing = { t1: { action: "update-partial", routeId: "route-1" } };
		expect(match('Return {"status":"ok"}', existing)).toBeNull();
	});

	it("declines when the run is also building a custom block", () => {
		const pending = [{ name: "x", customBlockId: "c1", inputParams: [] }];
		expect(
			staticResponseTemplate(task('Return {"ok":true}'), created, pending),
		).toBeNull();
	});

	it("declines a task with no single route to build against", () => {
		const orphan = { ...task('Return {"ok":true}'), dependsOnAgentId: [] };
		expect(staticResponseTemplate(orphan, created, [])).toBeNull();
	});

	it("declines a task with no body spelled out", () => {
		expect(match("Return a friendly greeting to the caller.")).toBeNull();
	});
});
