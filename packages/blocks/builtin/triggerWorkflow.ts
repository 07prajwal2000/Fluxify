import z from "zod";
import { baseBlockDataSchema, type Context } from "../baseBlock";
import {
	assertTriggerPayloadSize,
	CANCEL_SCHEDULE_JOB,
	enqueueJob,
	isScheduleId,
	resolveRunAt,
	TRIGGER_WORKFLOW_JOB,
	type JobRequest,
	type RetryPolicy,
} from "../jobs";
import { emitJsObject, type EmitNode } from "../compiler";

/**
 * Starts a workflow from a route or another workflow.
 *
 * It publishes; it does not call. Invoking the workflow in place would mean no
 * durability, no retry, no concurrency bound, and the workflow's blocks running
 * inside the caller's request — which is exactly what a workflow exists not to
 * do. The caller moves on as soon as the broker has the message.
 */

export const triggerWorkflowSchema = z
	.object({
		/**
		 * The workflow to start. Ids, not names — a rename must not break a graph.
		 * Empty until one is picked: an unconfigured block still has to save, the
		 * same way a database block saves before its connection is chosen.
		 */
		workflowId: z.string().default(""),
		/**
		 * When true the block forwards the previous block's output and ignores
		 * `data`. The common case is "pass what I already have", and making that a
		 * toggle beats making every user write `js: input`.
		 */
		useInput: z.boolean().default(false),
		/** What the workflow receives. A `js:` expression is evaluated first. */
		data: z.unknown().optional(),
		/** Runs before the event is dropped. Unset keeps the worker's default. */
		maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
		/** Wait before the first retry; doubles after each failed attempt. */
		retryDelayMs: z.coerce.number().int().min(0).max(300_000).optional(),
		/** `now` queues at once, `later` holds the run until `runAt`, `cancel` drops a held one. */
		mode: z.enum(["now", "later", "cancel"]).default("now"),
		/** ISO time or a delay like `24h`; `js:` allowed. Checked when the block runs. */
		runAt: z.string().default(""),
		/** The id a `later` block returned; `js:` allowed. */
		scheduleId: z.string().default(""),
	})
	.extend(baseBlockDataSchema.shape);

export function fireWorkflow(
	context: Context,
	workflowId: string,
	data: unknown,
	retry?: RetryPolicy,
) {
	queueRun(context, workflowId, data, retry);
}

/**
 * Holds a run until `runAt` and returns its handle. A time already past runs
 * now instead of failing: a computed expiry that slipped by a second must not
 * break the route that computed it.
 */
export function scheduleWorkflow(
	context: Context,
	workflowId: string,
	data: unknown,
	runAt: unknown,
	retry?: RetryPolicy,
) {
	const at = resolveRunAt(runAt);
	const id = crypto.randomUUID();
	const due = at.getTime() > Date.now();
	queueRun(context, workflowId, data, retry, { id, ...(due ? { runAt: at.toISOString() } : {}) });
	return { id, runAt: at.toISOString() };
}

/** Drops a held run. One that already started, or never existed, is a no-op. */
export function cancelSchedule(context: Context, id: unknown = "") {
	if (!isScheduleId(id))
		throw new Error(
			`cancelSchedule needs the id a scheduled Trigger Workflow block returned — got ${JSON.stringify(id)}`,
		);
	enqueueJob({ kind: CANCEL_SCHEDULE_JOB, projectId: context.projectId, target: id });
}

function queueRun(
	context: Context,
	workflowId: string,
	data: unknown,
	retry?: RetryPolicy,
	schedule?: Pick<JobRequest, "id" | "runAt">,
) {
	// The block saves without a workflow so a canvas can be a work in progress;
	// running without one is the point at which that stops being acceptable.
	if (!workflowId) throw new Error("Trigger Workflow block has no workflow selected");
	assertTriggerPayloadSize(context.projectId, data);
	enqueueJob({
		kind: TRIGGER_WORKFLOW_JOB,
		projectId: context.projectId,
		target: workflowId,
		payload: data,
		origin: { route: context.route, apiId: context.apiId },
		retry,
		...schedule,
	});
}

export function emitTriggerWorkflow(node: EmitNode) {
	const { workflowId, useInput, data, maxAttempts, retryDelayMs, mode, runAt, scheduleId } =
		(node.block.data ?? {}) as Record<string, unknown>;
	if (mode === "cancel")
		return `lib.cancelSchedule(ctx, ${node.value(scheduleId ?? "")});\n${node.next()}`;

	const retry = JSON.stringify({
		maxAttempts: numberOrUndefined(maxAttempts),
		retryDelayMs: numberOrUndefined(retryDelayMs),
	});
	const id = JSON.stringify(String(workflowId ?? ""));
	const payload = useInput ? node.in : emitJsObject({ data }, node);
	// `useInput` hands the previous block's value straight through; otherwise the
	// configured data is emitted, with `js:` expressions already evaluated by
	// `emitJsObject`.
	const value = useInput ? payload : `(${payload}).data`;
	// A later run outputs its handle, so the next block can keep the id to cancel it.
	if (mode === "later")
		return `${node.in} = lib.scheduleWorkflow(ctx, ${id}, ${value}, ${node.value(runAt ?? "")}, ${retry});\n${node.next()}`;
	return `lib.fireWorkflow(ctx, ${id}, ${value}, ${retry});\n${node.next()}`;
}

function numberOrUndefined(value: unknown) {
	if (value === undefined || value === null || value === "") return undefined;
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}
