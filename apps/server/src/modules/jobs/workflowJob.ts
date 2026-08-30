import { logger } from "@fluxify/common";
import { compiledWorkflow } from "../requestRouter/compiledRuntime";
import { createJobContext } from "../requestRouter/service";
import { registerJobHandler } from "./registry";
import { WORKFLOW_JOB } from "./subjects";

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

		const context = createJobContext({
			id: job.id,
			projectId: job.projectId,
			target: job.target,
			timeoutSeconds: workflow.artifact.timeoutSeconds,
			trigger: { kind: "workflow" },
			payload: job.payload,
		});
		try {
			const result = await workflow.run(context, job.payload);
			// The graph's error handler settles a failed run into a normal result, so
			// an unsuccessful outcome has to be turned back into a throw for the
			// queue to see it.
			if (result && result.successful === false) {
				throw new Error(
					`workflow ${workflow.artifact.name} failed: ${String(result.error ?? "unknown error")}`,
				);
			}
			logger.info(
				`[jobs] ran workflow ${workflow.artifact.name}`,
				"JOBS.workflow",
			);
		} finally {
			context.dbFactory?.dispose();
		}
	});
}
