import { describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

const dynamicStatus = await loadGraph("response/dynamic-status");

describe("response/dynamic-status", () => {
	it("sends the code the js expression returns", async () => {
		const run = await runGraph(dynamicStatus, { body: { code: 201 } });

		expect(run.status).toBe(201);
		expect(run.body).toEqual({ code: 201 });
	});

	it("takes a code returned as a string", async () => {
		const run = await runGraph(dynamicStatus, { body: { code: "404" } });

		expect(run.status).toBe(404);
	});

	it("fails the block when the code is not a known HTTP code", async () => {
		const run = await runGraph(dynamicStatus, { body: { code: 999 } });

		expect(run.status).toBe(500);
		expect(run.body.error).toContain("Response status code must be a known HTTP code, got 999");
	});
});
