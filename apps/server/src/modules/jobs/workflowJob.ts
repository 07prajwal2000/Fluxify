import { logger } from "@fluxify/common";
import type { TriggerBatchMeta, TriggerEvent } from "@fluxify/blocks";
import { compiledWorkflow } from "../requestRouter/compiledRuntime";
import { createJobContext } from "../requestRouter/service";
import { isTriggerBatch } from "../triggers/types";
import { registerJobHandler } from "./registry";
import { WORKFLOW_JOB } from "./subjects";
import type { JobEnvelope } from "./types";

/**
 * Runs one workflow off the queue.
 *
 * Registered on the execution process, next to the custom block handler — this
 * is the process that holds compiled graphs and may run user code. It throws on
 * failure so the consumer redelivers; nobody is waiting on the result, so the
 * queue is the only thing that can retry.
 */
export function registerWorkflowJobHandler() {
	registerJobHandler(WORKFLOW_JOB, async (job) => {
		const workflow = compiledWorkflow(job.target);
		// Not an error worth retrying on this worker: either the workflow was
		// deactivated while the job was queued, or this worker serves a different
		// project. Redelivering cannot change either.
		if (!workflow) {
			logger.warn(
				`[jobs] no compiled workflow ${job.target}, skipping`,
				"JOBS.workflow",
			);
			return;
		}

		const { events, input, meta, source } = readInput(job);
		const context = createJobContext({
			id: job.id,
			projectId: job.projectId,
			target: job.target,
			timeoutSeconds: workflow.artifact.timeoutSeconds,
			trigger: { kind: "trigger", source, data: events, meta },
			payload: input,
		});
		try {
			const result = await workflow.run(context, input);
			// The graph's error handler settles a failed run into a normal result, so
			// an unsuccessful outcome has to be turned back into a throw for the
			// queue to see it.
			if (result && result.successful === false) {
				throw new Error(
					`workflow ${workflow.artifact.name} failed: ${String(result.error ?? "unknown error")}`,
				);
			}
			logger.info(
				`[jobs] ran workflow ${workflow.artifact.name} over ${events.length} event(s)`,
				"JOBS.workflow",
			);
		} finally {
			context.dbFactory?.dispose();
		}
	});
}

/**
 * The events for this run, and what the entry block sees.
 *
 * `vars.trigger.data` is always an array, so a graph never has to branch on
 * batch size. `input` is the ergonomic view: the bare value at size 1, because
 * making every single-event workflow write `trigger.data[0].data` to reach its
 * payload would be a tax on the common case.
 *
 * A payload that is not a batch is one queued directly — a test-suite run, or
 * anything predating triggers. It becomes a batch of one rather than a second
 * shape for a graph to handle.
 */
export function readInput(job: JobEnvelope) {
	const batch = isTriggerBatch(job.payload)
		? job.payload
		: {
				triggerId: "internal" as const,
				source: "internal" as const,
				events: [
					{
						data: job.payload,
						meta: { id: job.id, receivedAt: job.enqueuedAt, source: "internal" },
					} satisfies TriggerEvent,
				],
			};

	const received = batch.events
		.map((event) => event.meta.receivedAt)
		.filter((at): at is string => typeof at === "string")
		.sort();

	const meta: TriggerBatchMeta = {
		batchId: job.id,
		size: batch.events.length,
		firstReceivedAt: received[0],
		lastReceivedAt: received.at(-1),
	};

	return {
		events: batch.events,
		meta,
		source: batch.source,
		input:
			batch.events.length === 1
				? batch.events[0]!.data
				: batch.events.map((event) => event.data),
	};
}
