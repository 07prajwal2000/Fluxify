import z from "zod";
import { baseBlockDataSchema, type Context } from "../baseBlock";
import { assertTriggerPayloadSize, enqueueJob, TRIGGER_WORKFLOW_JOB } from "../jobs";
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
	})
	.extend(baseBlockDataSchema.shape);

export function fireWorkflow(context: Context, workflowId: string, data: unknown) {
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
	});
}

export function emitTriggerWorkflow(node: EmitNode) {
	const { workflowId, useInput, data } = (node.block.data ?? {}) as Record<
		string,
		unknown
	>;
	const id = JSON.stringify(String(workflowId ?? ""));
	const payload = useInput ? node.in : emitJsObject({ data }, node);
	// `useInput` hands the previous block's value straight through; otherwise the
	// configured data is emitted, with `js:` expressions already evaluated by
	// `emitJsObject`.
	const value = useInput ? payload : `(${payload}).data`;
	return `lib.fireWorkflow(ctx, ${id}, ${value});\n${node.next()}`;
}
