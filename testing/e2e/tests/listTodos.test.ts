import { beforeEach, describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { resetDatabase } from "../src/engines";
import { mongo } from "../src/mongo";
import { runGraph } from "../src/runner";

const fixture = await loadGraph("list-todos");

beforeEach(() => resetDatabase("mongo"));

describe("list-todos", () => {
	it("returns only the todos matching the condition, in sorted order", async () => {
		const run = await runGraph(fixture);

		expect(run.status).toBe(200);
		expect(run.body.map((todo: any) => todo.title)).toEqual([
			"Rename variants",
			"Ship tracing",
		]);
	});

	it("runs every block in the graph", async () => {
		const run = await runGraph(fixture);
		expect(run.executed).toEqual(["entry", "list-todos", "reply"]);
		expect(run.spans.every((span) => span.outcome === "success")).toBe(true);
	});

	it("compares a numeric field numerically when the value arrives as a string", async () => {
		// the graph filters `priority lte "9"` — a string, which is what a text
		// input produces. Compared as text, "10" <= "9" is true and the priority 10
		// todo comes back; the adapter coerces numeric-like values on ordering
		// operators specifically so it does not.
		const run = await runGraph(fixture);
		expect(run.body.map((todo: any) => todo.priority)).toEqual([2, 3]);
	});

	it("projects the requested fields and exposes _id as a string id", async () => {
		const run = await runGraph(fixture);

		// `tags` was not requested, so the projection must have dropped it; `id`
		// always survives, mapped off _id
		expect(Object.keys(run.body[0]).sort()).toEqual([
			"id",
			"priority",
			"status",
			"title",
		]);
		expect(run.body[0].id).toMatch(/^[0-9a-f]{24}$/);
	});

	it("returns an empty list when nothing matches", async () => {
		const { db } = await mongo();
		await db.collection("todos").updateMany({}, { $set: { status: "done" } });

		const run = await runGraph(fixture);
		expect(run.status).toBe(200);
		expect(run.body).toEqual([]);
	});
});
