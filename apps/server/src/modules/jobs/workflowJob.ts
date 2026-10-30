import type { TriggerBatchMeta, TriggerConnection, TriggerEvent } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { compiledWorkflow } from "../requestRouter/compiledRuntime";
import { createJobContext } from "../requestRouter/service";
import { type TraceSinks, wantsSpans } from "../requestRouter/traceLifecycle";
import type { WorkflowTrace } from "../telemetry/routeRecorder";
import { isTriggerBatch } from "../triggers/types";
import { registerJobHandler } from "./registry";
import { trackRun } from "./runStops";
import { WORKFLOW_JOB } from "./subjects";
import type { JobEnvelope } from "./types";

export type WorkflowTraceFactory = {
	start(
		workflow: {
			workflowId: string;
			projectId: string;
			workflowVersion: string;
			/** the version this run served (#782); absent for the working copy */
			versionId?: string;
			workflowName: string;
			sandbox?: boolean;
		} & TraceSinks,
	): WorkflowTrace;
};

/** What an external queue or a plugin trigger adds to a run: its connection and batch metadata. */
export type QueueRunExtras = {
	/** a plugin trigger's `emit` may pass none */
	connection?: TriggerConnection;
	meta: Partial<TriggerBatchMeta>;
};

let traceFactory: WorkflowTraceFactory | undefined;

/**
 * Runs one workflow off the queue.
 *
 * Registered on the execution process, next to the custom block handler — this
 * is the process that holds compiled graphs and may run user code. It throws on
 * failure so the consumer redelivers; nobody is waiting on the result, so the
 * queue is the only thing that can retry.
 */
export function registerWorkflowJobHandler(factory?: WorkflowTraceFactory) {
	traceFactory = factory;
	registerJobHandler(WORKFLOW_JOB, (job) => runWorkflowJob(job));
}

/**
 * One workflow run, shared by queued jobs and external queue batches. Resolves
 * on success, throws on failure, and resolves without running when this
 * process holds no such workflow or a stop already reached this run. A stopped
 * run always resolves, so the queue never retries it.
 */
export async function runWorkflowJob(job: JobEnvelope, extras?: QueueRunExtras) {
	const run = trackRun(job);
	try {
		if (run?.signal.aborted) {
			logger.info(`[jobs] run ${job.runKey} was stopped before it started`, "JOBS.workflow");
			return;
		}
		await executeWorkflow(job, extras, run?.signal);
	} finally {
		run?.end();
	}
}

/** Where a stopped run's outcome is recorded. Its spans are kept. */
function completeStopped(job: JobEnvelope, trace: WorkflowTrace | undefined) {
	try {
		trace?.complete("cancelled");
	} catch {
		// Telemetry must never affect job outcome.
	}
	logger.info(`[jobs] run ${job.runKey} stopped`, "JOBS.workflow");
}

async function executeWorkflow(
	job: JobEnvelope,
	extras: QueueRunExtras | undefined,
	signal: AbortSignal | undefined,
) {
	const workflow = compiledWorkflow(job.target);
	// Not an error worth retrying on this worker: either the workflow was
	// deactivated while the job was queued, or this worker serves a different
	// project. Redelivering cannot change either.
	if (!workflow) {
		logger.warn(`[jobs] no compiled workflow ${job.target}, skipping`, "JOBS.workflow");
		return;
	}

	let trace: WorkflowTrace | undefined;
	if (wantsSpans(workflow.artifact) && traceFactory) {
		try {
			trace = traceFactory.start({
				workflowId: workflow.artifact.workflowId,
				projectId: workflow.artifact.projectId,
				workflowVersion: workflow.artifact.workflowVersion,
				versionId: workflow.artifact.versionId,
				workflowName: workflow.artifact.name,
				tracingEnabled: workflow.artifact.tracingEnabled,
				recordExecution: workflow.artifact.recordExecution,
				...(workflow.artifact.sandbox ? { sandbox: true } : {}),
			});
		} catch {
			// Tracing is diagnostic data; a recorder bug must not fail job execution.
		}
	}

	const { events, input, meta, source, triggerId } = readInput(job);
	const context = createJobContext({
		id: job.id,
		projectId: job.projectId,
		target: job.target,
		timeoutSeconds: workflow.artifact.timeoutSeconds,
		trigger: {
			kind: "trigger",
			source,
			data: events,
			meta: { ...meta, ...extras?.meta },
			connection: extras?.connection,
		},
		payload: input,
		trace,
		signal,
	});
	// only when spans are compiled in (#628): what the start block was handed, and by what
	if (trace)
		context.traceInput = { input, trigger: triggerDetails(job, triggerId, source, context) };
	try {
		const result = await workflow.run(context, input);
		if (signal?.aborted) return completeStopped(job, trace);
		// The graph's error handler settles a failed run into a normal result, so
		// an unsuccessful outcome has to be turned back into a throw for the
		// queue to see it.
		if (result && result.successful === false) {
			throw new Error(
				`workflow ${workflow.artifact.name} failed: ${String(result.error ?? "unknown error")}`,
			);
		}
		try {
			trace?.complete("success");
		} catch {
			// Telemetry must never affect job outcome.
		}
		logger.info(
			`[jobs] ran workflow ${workflow.artifact.name} over ${events.length} event(s)`,
			"JOBS.workflow",
		);
	} catch (error) {
		// also a failure that merely coincided with the stop: it must not be retried
		if (signal?.aborted) return completeStopped(job, trace);
		try {
			trace?.complete("failure");
		} catch {
			// Telemetry must never affect job outcome.
		}
		throw error;
	} finally {
		context.dbFactory?.dispose();
	}
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
		triggerId: batch.triggerId,
		input:
			batch.events.length === 1 ? batch.events[0]!.data : batch.events.map((event) => event.data),
	};
}

/**
 * The trigger side of a workflow start span (#628): which trigger, and the
 * source's own details — a cron's fire time, a message's id and subject or
 * key, a delayed run's time, or a manual / test run's origin.
 */
export function triggerDetails(
	job: JobEnvelope,
	triggerId: string,
	source: string,
	context: ReturnType<typeof createJobContext>,
) {
	return {
		id: triggerId,
		type: source,
		...(job.origin ? { origin: job.origin } : {}),
		...(job.runAt ? { runAt: job.runAt } : {}),
		batch: context.trigger?.meta,
		events: (context.trigger?.data ?? []).map((event) => event.meta),
	};
}
