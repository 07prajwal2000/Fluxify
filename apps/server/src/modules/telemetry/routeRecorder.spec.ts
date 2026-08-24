import { describe, expect, it } from "bun:test";
import { RouteTraceRecorder } from "./routeRecorder";

const route = {
	projectId: "project-1",
	routeId: "route-1",
	routeVersion: "2026-08-24T00:00:00.000Z",
	method: "POST",
	path: "/orders",
};

describe("RouteTraceRecorder", () => {
	it("emits one bounded, serializable completed route run", () => {
		const runs: any[] = [];
		const recorder = new RouteTraceRecorder(route, (run) => runs.push(run));

		recorder.recordSpan({
			blockId: "entry",
			blockType: "entrypoint",
			input: { id: 42n },
			output: { accepted: true },
			startedAt: 10,
			endedAt: 15,
			outcome: "success",
		});
		recorder.complete("success", 201);
		recorder.complete("failure", 500);

		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			...route,
			statusCode: 201,
			outcome: "success",
			spans: [
				{
					seq: 0,
					blockId: "entry",
					input: { id: "42" },
					output: { accepted: true },
				},
			],
		});
	});

	it("links synchronous custom-block spans to their invoking block", () => {
		const runs: any[] = [];
		const recorder = new RouteTraceRecorder(route, (run) => runs.push(run));
		const scope = recorder.enterCustomBlock({
			blockId: "invoke",
			name: "address_lookup",
			detached: false,
		});

		scope.trace.recordSpan({
			blockId: "custom-entry",
			blockType: "entrypoint",
			input: null,
			output: null,
			startedAt: 10,
			endedAt: 12,
			outcome: "success",
		});
		recorder.recordSpan({
			blockId: "invoke",
			blockType: "custom_block",
			input: null,
			output: null,
			startedAt: 9,
			endedAt: 13,
			outcome: "success",
		});
		recorder.complete("success", 200);

		expect(runs[0].spans).toEqual([
			expect.objectContaining({
				seq: 1,
				parentSeq: 0,
			}),
			expect.objectContaining({ seq: 0, blockId: "invoke" }),
		]);
	});

	it("publishes a detached custom block as a linked, independent run", () => {
		const runs: any[] = [];
		const recorder = new RouteTraceRecorder(route, (run) => runs.push(run));
		const scope = recorder.enterCustomBlock({
			blockId: "notify",
			name: "send_email",
			detached: true,
		});
		scope.trace.recordSpan({
			blockId: "email",
			blockType: "http_request",
			input: null,
			output: null,
			startedAt: 10,
			endedAt: 12,
			outcome: "success",
		});
		scope.close("failure", new Error("mail provider unavailable"));
		recorder.complete("success", 202);

		expect(runs).toHaveLength(2);
		expect(runs[0]).toMatchObject({
			parentRunId: recorder.runId,
			parentSeq: 0,
			outcome: "failure",
		});
		expect(runs[1]).toMatchObject({ runId: recorder.runId, statusCode: 202 });
	});
});
