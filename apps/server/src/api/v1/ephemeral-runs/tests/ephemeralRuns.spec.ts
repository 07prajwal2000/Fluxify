import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as callModule from "../../sandboxes/call";
import type { RunBody } from "../dto";
import { callWhenLoaded } from "../service";

const body = {
	method: "GET",
	blocks: [{ ref: "run", type: "entrypoint", data: {} }],
	edges: [],
} as RunBody;

/** A 404/401 that carries no trace — i.e. a worker that has not loaded the run. */
function notLoaded(status: number) {
	return { status, contentType: null, body: { message: "Route not found" } };
}

beforeEach(() => {
	spyOn(callModule, "callDevWorker").mockRestore();
});

describe("callWhenLoaded", () => {
	it("returns the never-loaded error when 404 with no trace hits the deadline", async () => {
		spyOn(callModule, "callDevWorker").mockResolvedValue(notLoaded(404));

		const result = await callWhenLoaded("proj", "run1", body, "http://origin", Date.now() + 1);

		expect(result.status).toBe(404);
		expect(result.error).toContain("never loaded this run");
		expect(result.error).toContain("artifact watch may be down");
	});

	it("returns the first real answer without the never-loaded error", async () => {
		spyOn(callModule, "callDevWorker").mockResolvedValue({
			status: 200,
			contentType: "application/json",
			body: { n: 1 },
			debugTrace: { spans: [] },
		});

		const result = await callWhenLoaded("proj", "run1", body, "http://origin", Date.now() + 1000);

		expect(result.status).toBe(200);
		expect(result.error).toBeUndefined();
	});
});
