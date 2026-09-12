import { logger } from "@fluxify/common";
import {
	consumeBatches,
	dropWildcardConsumers,
	ensureStream,
	ensureConsumer,
	type QueueConsumer,
} from "@fluxify/common/nats";
import type { TriggerEvent } from "@fluxify/blocks";
import { natsConnection } from "../../db/nats";
import type { TriggerArtifact } from "../compiler/artifacts";
import { WORKFLOW_JOB } from "../jobs/subjects";
import type { JobEnvelope } from "../jobs/types";
import {
	ALL_PROJECTS,
	INTERNAL_SOURCE,
	TRIGGERS_STREAM,
	TRIGGERS_SUBJECTS,
	internalConsumerName,
	internalSubject,
	triggerConsumerName,
	triggerSubject,
} from "./subjects";
import type { InternalTriggerMessage, TriggerBatch } from "./types";

/**
 * The trigger half of a worker: one consumer per trigger, plus one per project
 * for its internal subject.
 *
 * Per project, because `FLUXIFY_TRIGGERS` is work-queue and one
 * `fluxify.triggers.*.internal` consumer overlaps every
 * `fluxify.triggers.<project>.internal` one — a catch-all worker holding the
 * wildcard would stop any project with a node of its own from booting. A
 * catch-all deployment is told which projects it serves as their artifacts
 * arrive.
 *
 * Consumers come and go with the trigger artifacts, so creating or deleting a
 * trigger starts or stops its consumer with no restart. The work itself is
 * handed to the same `run` the job worker uses — a batch is a job whose payload
 * happens to hold several events, which keeps one path to the execution process
 * and one place where the ack is decided.
 */

export type TriggerWorkerOptions = {
	/**
	 * Project this deployment serves, or "*" for every project. A concrete id is
	 * served by `start()`; a catch-all deployment calls `serveInternal` per
	 * project instead.
	 */
	projectId: string;
	/** Runs one batch. Resolve to ack the batch, reject to retry it. */
	run: (job: JobEnvelope) => Promise<void>;
	/** Attempts before a batch is dropped. */
	maxDeliver?: number;
	/** Wait before a failed batch is redelivered. */
	retryDelayMs?: number;
	/** How long an unclaimed event stays on the stream. */
	maxAgeMs?: number;
	/**
	 * The workflow's own timeout, in seconds, or undefined when this worker has
	 * not been sent that artifact yet. The ack wait is derived from it.
	 */
	workflowTimeoutSeconds?: (workflowId: string) => number | undefined;
	/** Ack wait when the workflow's timeout is not known yet. */
	defaultAckWaitMs?: number;
};

const DEFAULTS = {
	maxDeliver: 5,
	retryDelayMs: 10_000,
	maxAgeMs: 7 * 24 * 60 * 60_000,
	defaultAckWaitMs: 5 * 60_000,
};

type Running = { consumer: QueueConsumer; artifact: TriggerArtifact };

export class TriggerWorker {
	private readonly options: Required<TriggerWorkerOptions>;
	private readonly running = new Map<string, Running>();
	/** Project id → its internal-subject consumer. */
	private readonly internal = new Map<string, QueueConsumer>();
	private started = false;

	constructor(options: TriggerWorkerOptions) {
		this.options = { ...DEFAULTS, ...stripUndefined(options) } as Required<TriggerWorkerOptions>;
	}

	/**
	 * Provisions the stream, and this deployment's internal consumer when it
	 * serves one named project.
	 *
	 * The wildcard sweep runs here for the same reason it does on the jobs
	 * stream: one leftover `fluxify.triggers.*.internal` durable from an older
	 * build refuses every per-project consumer below, permanently.
	 */
	async start() {
		if (this.started) return;
		this.started = true;
		const nc = natsConnection();
		await ensureStream(nc, {
			name: TRIGGERS_STREAM,
			subjects: [TRIGGERS_SUBJECTS],
			// an event is work, not history: once acked it leaves the stream
			retention: "workqueue",
			maxAgeMs: this.options.maxAgeMs,
			duplicateWindowMs: 2 * 60_000,
		});
		await dropWildcardConsumers(nc, TRIGGERS_STREAM);

		if (this.options.projectId !== ALL_PROJECTS)
			await this.serveInternal(this.options.projectId);
	}

	/**
	 * Starts one project's internal subject — what the Trigger Workflow block
	 * and the portal's Run button publish to. Idempotent.
	 */
	async serveInternal(projectId: string) {
		if (this.internal.has(projectId)) return;
		const nc = natsConnection();
		const durable = internalConsumerName(projectId);
		await ensureConsumer(nc, TRIGGERS_STREAM, {
			durable,
			filterSubjects: [internalSubject(projectId)],
			ackWaitMs: this.options.defaultAckWaitMs,
			maxDeliver: this.options.maxDeliver,
			maxAckPending: 1,
		});

		// Size 1: the block fires one workflow at a time, and batching events
		// aimed at different workflows would mean splitting them apart again.
		const consumer = await consumeBatches<InternalTriggerMessage>(
			nc,
			TRIGGERS_STREAM,
			durable,
			async (batch) => {
				for (const message of batch) await this.runInternal(projectId, message.data);
			},
			{
				maxMessages: 1,
				maxBytes: MAX_INTERNAL_BATCH_BYTES,
				maxAttempts: this.options.maxDeliver,
				retryDelayMs: this.options.retryDelayMs,
				policy: (batch) => batch[0]?.data.retry,
			},
		);
		this.internal.set(projectId, consumer);
		logger.info(
			`[triggers] internal consumer listening on ${internalSubject(projectId)}`,
			"TRIGGERS",
		);
	}

	/** Stops one project's internal subject — it was deleted, or moved away. */
	async unserveInternal(projectId: string) {
		const consumer = this.internal.get(projectId);
		if (!consumer) return;
		this.internal.delete(projectId);
		await consumer.stop();
	}

	/**
	 * Reacts to a trigger artifact appearing, changing or being withdrawn.
	 *
	 * An artifact that is gone means the trigger was deleted or deactivated, and
	 * either way this worker must stop pulling for it.
	 */
	async apply(triggerId: string, artifact: TriggerArtifact | null) {
		const current = this.running.get(triggerId);
		if (!artifact) {
			if (!current) return;
			await current.consumer.stop();
			this.running.delete(triggerId);
			logger.info(`[triggers] stopped consumer for ${triggerId}`, "TRIGGERS");
			return;
		}

		// Only the batch shape can change without a restart being pointless, and
		// re-fetching with new limits means tearing the loop down anyway.
		if (current) {
			if (unchanged(current.artifact, artifact)) return;
			await current.consumer.stop();
			this.running.delete(triggerId);
		}

		const consumer = await this.startTrigger(artifact);
		this.running.set(triggerId, { consumer, artifact });
	}

	/** Whether this worker currently holds a consumer for a trigger. */
	has(triggerId: string) {
		return this.running.has(triggerId);
	}

	/** Stops every consumer. In-flight batches are left to finish. */
	async stop() {
		await Promise.allSettled([
			...[...this.internal.values()].map((consumer) => consumer.stop()),
			...[...this.running.values()].map((entry) => entry.consumer.stop()),
		]);
		this.running.clear();
		this.internal.clear();
		this.started = false;
	}

	private async startTrigger(artifact: TriggerArtifact) {
		const nc = natsConnection();
		const durable = triggerConsumerName(artifact.triggerId);
		await ensureConsumer(nc, TRIGGERS_STREAM, {
			durable,
			filterSubjects: [triggerSubject(artifact.projectId, artifact.triggerId)],
			ackWaitMs: this.ackWaitFor(artifact),
			maxDeliver: this.attemptsFor(artifact),
			maxAckPending: artifact.batchSize * artifact.concurrency,
		});

		const consumer = await consumeBatches<unknown>(
			nc,
			TRIGGERS_STREAM,
			durable,
			(batch) =>
				this.runBatch(
					artifact,
					batch.map((message) => ({
						data: message.data,
						meta: {
							id: message.msg.headers?.get("Nats-Msg-Id") || undefined,
							receivedAt: new Date().toISOString(),
							source: artifact.type as TriggerEvent["meta"]["source"],
							redelivered: message.redelivered,
						},
					})),
				),
			{
				maxMessages: artifact.batchSize,
				maxBytes: artifact.maxBytes,
				maxWaitMs: artifact.maxWaitMs,
				concurrency: artifact.concurrency,
				maxAttempts: this.attemptsFor(artifact),
				retryDelayMs: artifact.retryDelayMs ?? this.options.retryDelayMs,
			},
		);
		logger.info(
			`[triggers] consumer for ${artifact.triggerId} -> ${artifact.workflowId} (batch ${artifact.batchSize})`,
			"TRIGGERS",
		);
		return consumer;
	}

	private runInternal(projectId: string, message: InternalTriggerMessage) {
		return this.dispatch(projectId, message.workflowId, {
			triggerId: INTERNAL_SOURCE,
			source: "internal",
			events: [
				{
					data: message.data,
					meta: {
						receivedAt: new Date().toISOString(),
						source: "internal",
						...(message.origin ?? {}),
					},
				},
			],
		});
	}

	private runBatch(artifact: TriggerArtifact, events: TriggerEvent[]) {
		return this.dispatch(artifact.projectId, artifact.workflowId, {
			triggerId: artifact.triggerId,
			source: artifact.type as TriggerBatch["source"],
			events,
		});
	}

	/**
	 * One batch, one job. Resolving acks the batch; throwing redelivers it.
	 *
	 * The project comes from the event's own consumer rather than from this
	 * deployment's setting: on a catch-all worker the setting is `*`, which is
	 * not a project any workflow can be looked up in.
	 */
	private dispatch(projectId: string, workflowId: string, batch: TriggerBatch) {
		return this.options.run({
			id: crypto.randomUUID(),
			kind: WORKFLOW_JOB,
			projectId,
			target: workflowId,
			payload: batch,
			origin: { triggerId: batch.triggerId, source: batch.source },
			enqueuedAt: new Date().toISOString(),
		} satisfies JobEnvelope);
	}

	/**
	 * A batch may run for as long as its workflow may, so the broker must wait
	 * at least that long before assuming the worker died. This is derived rather
	 * than configured on purpose: two numbers that must agree is a bug
	 * generator, and a 90s batch under a 30s ack wait is redelivered mid-flight
	 * and runs twice.
	 *
	 * The margin covers the hop to the execution process and back, which is not
	 * part of the workflow's own budget.
	 */
	/** The trigger's own setting, capped at 5 for rows saved before the cap. */
	private attemptsFor(artifact: TriggerArtifact) {
		return Math.min(MAX_ATTEMPTS, artifact.maxAttempts ?? this.options.maxDeliver);
	}

	private ackWaitFor(artifact: TriggerArtifact) {
		const seconds = this.options.workflowTimeoutSeconds?.(artifact.workflowId);
		if (!seconds) return this.options.defaultAckWaitMs;
		return seconds * 1000 + ACK_WAIT_MARGIN_MS;
	}
}

/** The internal path carries one event, so its bound is the payload cap plus slack. */
const MAX_INTERNAL_BATCH_BYTES = 1024 * 1024;
/** Room for the trip to the execution process, on top of the workflow's budget. */
const ACK_WAIT_MARGIN_MS = 30_000;
const MAX_ATTEMPTS = 5;

function unchanged(a: TriggerArtifact, b: TriggerArtifact) {
	return (
		a.workflowId === b.workflowId &&
		a.batchSize === b.batchSize &&
		a.maxWaitMs === b.maxWaitMs &&
		a.maxBytes === b.maxBytes &&
		a.concurrency === b.concurrency &&
		a.maxAttempts === b.maxAttempts &&
		a.retryDelayMs === b.retryDelayMs &&
		a.type === b.type &&
		a.integrationId === b.integrationId
	);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}
