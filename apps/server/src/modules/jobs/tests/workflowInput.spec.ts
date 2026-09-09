import { describe, expect, it } from "bun:test";
import { readInput } from "../workflowJob";
import type { JobEnvelope } from "../types";
import type { TriggerBatch } from "../../triggers/types";

/**
 * The input contract a workflow author actually writes against.
 *
 * The rule worth protecting: `trigger.data` is an array at every size, so
 * raising a trigger's batch size never silently changes what a graph reads.
 */

const job = (payload: unknown): JobEnvelope => ({
	id: "job-1",
	kind: "workflow",
	projectId: "p1",
	target: "wf-1",
	payload,
	enqueuedAt: "2026-01-01T00:00:00.000Z",
});

const batch = (events: TriggerBatch["events"]): TriggerBatch => ({
	triggerId: "t-1",
	source: "kafka",
	events,
});

describe("readInput", () => {
	it("keeps trigger.data an array for a single event", () => {
		const result = readInput(
			job(batch([{ data: { id: "a" }, meta: { id: "m1" } }])),
		);
		expect(result.events).toHaveLength(1);
		expect(result.meta.size).toBe(1);
	});

	it("unwraps input at size 1, so the common case reads its payload directly", () => {
		const result = readInput(
			job(batch([{ data: { id: "a" }, meta: { id: "m1" } }])),
		);
		expect(result.input).toEqual({ id: "a" });
	});

	it("hands a larger batch every event, in order", () => {
		const result = readInput(
			job(
				batch([
					{ data: { id: "a" }, meta: {} },
					{ data: { id: "b" }, meta: {} },
					{ data: { id: "c" }, meta: {} },
				]),
			),
		);
		expect(result.meta.size).toBe(3);
		expect(result.input).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
	});

	it("reports the batch window from the events' own timestamps", () => {
		const result = readInput(
			job(
				batch([
					{ data: 1, meta: { receivedAt: "2026-01-01T00:00:02.000Z" } },
					{ data: 2, meta: { receivedAt: "2026-01-01T00:00:01.000Z" } },
				]),
			),
		);
		expect(result.meta.firstReceivedAt).toBe("2026-01-01T00:00:01.000Z");
		expect(result.meta.lastReceivedAt).toBe("2026-01-01T00:00:02.000Z");
	});

	it("carries the source through, so a graph can tell where an event came from", () => {
		expect(readInput(job(batch([{ data: 1, meta: {} }]))).source).toBe("kafka");
	});

	it("turns a directly queued payload into a batch of one", () => {
		// anything predating triggers, or a test-suite run: one shape reaches the
		// graph, not two
		const result = readInput(job({ orderId: "A-1" }));
		expect(result.source).toBe("internal");
		expect(result.events).toEqual([
			{
				data: { orderId: "A-1" },
				meta: {
					id: "job-1",
					receivedAt: "2026-01-01T00:00:00.000Z",
					source: "internal",
				},
			},
		]);
		expect(result.input).toEqual({ orderId: "A-1" });
	});

	it("survives a job with no payload at all", () => {
		const result = readInput(job(undefined));
		expect(result.meta.size).toBe(1);
		expect(result.input).toBeUndefined();
	});
});
