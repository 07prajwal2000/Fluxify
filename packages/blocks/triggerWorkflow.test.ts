import { afterEach, describe, expect, it } from "bun:test";
import {
	assertTriggerPayloadSize,
	setJobEnqueuer,
	setTriggerPayloadLimit,
	TRIGGER_WORKFLOW_JOB,
	type JobRequest,
} from "./jobs";
import { fireWorkflow } from "./builtin/triggerWorkflow";
import type { Context } from "./baseBlock";

/**
 * The Trigger Workflow block's two jobs: put the right message on the queue,
 * and refuse a payload that would hurt the broker.
 */

const context = { projectId: "p1", route: "/orders", apiId: "r1" } as Context;

afterEach(() => {
	setJobEnqueuer();
	setTriggerPayloadLimit();
});

describe("fireWorkflow", () => {
	it("queues the workflow rather than invoking it in place", () => {
		const queued: JobRequest[] = [];
		setJobEnqueuer((job) => queued.push(job));

		fireWorkflow(context, "wf-1", { orderId: "A-1" });

		expect(queued).toEqual([
			{
				kind: TRIGGER_WORKFLOW_JOB,
				projectId: "p1",
				target: "wf-1",
				payload: { orderId: "A-1" },
				origin: { route: "/orders", apiId: "r1" },
			},
		]);
	});

	it("throws when no queue is wired instead of dropping the trigger", () => {
		expect(() => fireWorkflow(context, "wf-1", {})).toThrow(/no job queue/i);
	});
});

describe("the payload cap", () => {
	it("passes a payload under the limit", () => {
		setTriggerPayloadLimit(() => 1024);
		expect(() => assertTriggerPayloadSize("p1", { a: "x".repeat(100) })).not.toThrow();
	});

	it("refuses one over it, and says what to do instead", () => {
		setTriggerPayloadLimit(() => 1024);
		expect(() => assertTriggerPayloadSize("p1", { a: "x".repeat(2000) })).toThrow(
			/over this project's 1024 byte limit.*dedicated trigger/is,
		);
	});

	it("measures encoded bytes, not string length", () => {
		// 400 astral-plane characters: 400 UTF-16 code units of source, but four
		// bytes each on the wire, so a length check would let this through.
		setTriggerPayloadLimit(() => 1024);
		expect(() => assertTriggerPayloadSize("p1", "🙂".repeat(400))).toThrow(/over/);
	});

	it("stops the block before it queues anything", () => {
		const queued: JobRequest[] = [];
		setJobEnqueuer((job) => queued.push(job));
		setTriggerPayloadLimit(() => 16);

		expect(() => fireWorkflow(context, "wf-1", { big: "x".repeat(100) })).toThrow();
		expect(queued).toEqual([]);
	});

	it("does nothing when the host wired no limit", () => {
		expect(() => assertTriggerPayloadSize("p1", { a: "x".repeat(10_000) })).not.toThrow();
	});
});
