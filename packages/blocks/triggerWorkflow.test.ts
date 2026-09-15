import { afterEach, describe, expect, it } from "bun:test";
import {
	assertTriggerPayloadSize,
	CANCEL_SCHEDULE_JOB,
	isScheduleId,
	resolveRunAt,
	setJobEnqueuer,
	setScheduleHorizon,
	setTriggerPayloadLimit,
	TRIGGER_WORKFLOW_JOB,
	type JobRequest,
} from "./jobs";
import {
	cancelSchedule,
	emitTriggerWorkflow,
	fireWorkflow,
	scheduleWorkflow,
	triggerWorkflowSchema,
} from "./builtin/triggerWorkflow";
import type { Context } from "./baseBlock";
import type { EmitNode } from "./compiler";

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

	it("carries the block's retry settings with the job", () => {
		const queued: JobRequest[] = [];
		setJobEnqueuer((job) => queued.push(job));

		fireWorkflow(context, "wf-1", {}, { maxAttempts: 2, retryDelayMs: 5000 });

		expect(queued[0]!.retry).toEqual({ maxAttempts: 2, retryDelayMs: 5000 });
	});

	it("refuses more than 5 attempts", () => {
		expect(() => triggerWorkflowSchema.parse({ blockName: "x", maxAttempts: "6" })).toThrow();
		expect(triggerWorkflowSchema.parse({ blockName: "x", maxAttempts: "3" }).maxAttempts).toBe(3);
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

describe("scheduleWorkflow", () => {
	afterEach(() => setScheduleHorizon());

	function capture() {
		const queued: JobRequest[] = [];
		setJobEnqueuer((job) => queued.push(job));
		return queued;
	}

	it("holds the run until an ISO time and hands back its id", () => {
		const queued = capture();
		const handle = scheduleWorkflow(context, "wf-1", { a: 1 }, "2999-01-01T09:00:00Z");

		expect(handle).toEqual({ id: expect.any(String), runAt: "2999-01-01T09:00:00.000Z" });
		expect(queued[0]).toMatchObject({
			kind: TRIGGER_WORKFLOW_JOB,
			target: "wf-1",
			id: handle.id,
			runAt: handle.runAt,
		});
		expect(isScheduleId(handle.id)).toBe(true);
	});

	it("reads a delay relative to now", () => {
		const now = Date.parse("2026-01-01T00:00:00Z");
		expect(resolveRunAt("1h30m", now).toISOString()).toBe("2026-01-01T01:30:00.000Z");
		expect(resolveRunAt("2026-01-01T05:30:00+05:30", now).toISOString()).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});

	it("runs a time already past straight away, still with a handle", () => {
		const queued = capture();
		const handle = scheduleWorkflow(context, "wf-1", {}, "2000-01-01T00:00:00Z");

		expect(queued[0]!.runAt).toBeUndefined();
		expect(queued[0]!.id).toBe(handle.id);
	});

	it("refuses anything that is not an ISO time or a delay, queueing nothing", () => {
		const queued = capture();
		for (const bad of ["tomorrow", "2026-01-01", "10 minutes", "7d", "", 1234, null])
			expect(() => scheduleWorkflow(context, "wf-1", {}, bad)).toThrow(/Run at must be/);
		expect(queued).toEqual([]);
	});

	it("refuses a time past the deployment's horizon", () => {
		capture();
		setScheduleHorizon(60 * 60_000);
		expect(() => scheduleWorkflow(context, "wf-1", {}, "2h")).toThrow(/further ahead/);
		expect(() => scheduleWorkflow(context, "wf-1", {}, "30m")).not.toThrow();
	});
});

describe("cancelSchedule", () => {
	it("queues a cancel for the run id", () => {
		const queued: JobRequest[] = [];
		setJobEnqueuer((job) => queued.push(job));
		const id = crypto.randomUUID();

		cancelSchedule(context, id);

		expect(queued).toEqual([{ kind: CANCEL_SCHEDULE_JOB, projectId: "p1", target: id }]);
	});

	it("refuses anything but a run id — a wildcard would cancel every run", () => {
		setJobEnqueuer(() => {});
		for (const bad of ["", "*", ">", "abc", undefined])
			expect(() => cancelSchedule(context, bad)).toThrow(/cancelSchedule needs/);
	});
});

describe("emitTriggerWorkflow", () => {
	const node = (data: Record<string, unknown>) =>
		({
			block: { data },
			in: "$in",
			next: () => "",
			value: (raw: unknown) => JSON.stringify(raw),
		}) as unknown as EmitNode;

	it("outputs the handle for a later run", () => {
		const code = emitTriggerWorkflow(
			node({ workflowId: "wf-1", useInput: true, mode: "later", runAt: "24h" }),
		);
		expect(code).toStartWith(`$in = lib.scheduleWorkflow(ctx, "wf-1", $in, "24h",`);
	});

	it("cancels without touching the flowing value", () => {
		expect(emitTriggerWorkflow(node({ mode: "cancel", scheduleId: "x" }))).toStartWith(
			`lib.cancelSchedule(ctx, "x");`,
		);
	});

	it("keeps blocks saved before modes existed running now", () => {
		expect(emitTriggerWorkflow(node({ workflowId: "wf-1", useInput: true }))).toStartWith(
			"lib.fireWorkflow(",
		);
	});
});

describe("an unconfigured block", () => {
	it("saves with no workflow chosen, defaulting the rest", () => {
		const parsed = triggerWorkflowSchema.parse({ blockName: "Kick off billing" });
		expect(parsed).toMatchObject({
			workflowId: "",
			useInput: false,
			blockName: "Kick off billing",
		});
	});

	it("refuses to run without one, rather than queueing a job to nowhere", () => {
		setJobEnqueuer(() => {});
		expect(() => fireWorkflow(context, "", {})).toThrow(/no workflow selected/i);
	});
});
