import { logger } from "@fluxify/common";
import {
	consumeBatches,
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
 * The trigger half of a worker: one consumer per trigger, plus one for the
 * project's internal subject.
 *
 * Consumers come and go with the trigger artifacts, so creating or deleting a
 * trigger starts or stops its consumer with no restart. The work itself is
 * handed to the same `run` the job worker uses — a batch is a job whose payload
 * happens to hold several events, which keeps one path to the execution process
 * and one place where the ack is decided.
 */

export type TriggerWorkerOptions = {
	/** Project this deployment serves, or "*" for every project. */
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
	private internal: QueueConsumer | undefined;
	private started = false;

	constructor(options: TriggerWorkerOptions) {
		this.options = { ...DEFAULTS, ...stripUndefined(options) } as Required<TriggerWorkerOptions>;
	}

	/** Provisions the stream and the project's internal consumer. */
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

		const durable = internalConsumerName(this.options.projectId);
		await ensureConsumer(nc, TRIGGERS_STREAM, {
			durable,
			filterSubjects: [internalSubject(this.options.projectId)],
			ackWaitMs: this.options.defaultAckWaitMs,
			maxDeliver: this.options.maxDeliver,
			maxAckPending: 1,
		});

		// Size 1: the block fires one workflow at a time, and batching events
		// aimed at different workflows would mean splitting them apart again.
		this.internal = await consumeBatches<InternalTriggerMessage>(
			nc,
			TRIGGERS_STREAM,
			durable,
			async (batch) => {
				for (const message of batch) await this.runInternal(message.data);
			},
			{
				maxMessages: 1,
				maxBytes: MAX_INTERNAL_BATCH_BYTES,
				maxAttempts: this.options.maxDeliver,
				retryDelayMs: this.options.retryDelayMs,
			},
		);
		logger.info(
			`[triggers] internal consumer listening on ${internalSubject(this.options.projectId)}`,
			"TRIGGERS",
		);
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
			this.internal?.stop(),
			...[...this.running.values()].map((entry) => entry.consumer.stop()),
		]);
		this.running.clear();
		this.internal = undefined;
		this.started = false;
	}

	private async startTrigger(artifact: TriggerArtifact) {
		const nc = natsConnection();
		const durable = triggerConsumerName(artifact.triggerId);
		await ensureConsumer(nc, TRIGGERS_STREAM, {
			durable,
			filterSubjects: [triggerSubject(artifact.projectId, artifact.triggerId)],
			ackWaitMs: this.ackWaitFor(artifact),
			maxDeliver: this.options.maxDeliver,
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
				maxAttempts: this.options.maxDeliver,
				retryDelayMs: this.options.retryDelayMs,
			},
		);
		logger.info(
			`[triggers] consumer for ${artifact.triggerId} -> ${artifact.workflowIds.length} workflow(s) (batch ${artifact.batchSize})`,
			"TRIGGERS",
		);
		return consumer;
	}

	private runInternal(message: InternalTriggerMessage) {
		return this.dispatch([message.workflowId], {
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
		return this.dispatch(artifact.workflowIds, {
			triggerId: artifact.triggerId,
			source: artifact.type as TriggerBatch["source"],
			events,
		});
	}

	/**
	 * One batch, one job per linked workflow.
	 *
	 * The jobs are independent on purpose: a workflow that throws is retried on
	 * its own rather than dragging its siblings through the same batch again.
	 * The whole set has to be handed over before the message is acked, though,
	 * so a failure here redelivers the batch and every workflow sees it again —
	 * which is the same at-least-once contract a single workflow already had.
	 */
	private async dispatch(workflowIds: string[], batch: TriggerBatch) {
		for (const workflowId of workflowIds) {
			const job: JobEnvelope = {
				id: crypto.randomUUID(),
				kind: WORKFLOW_JOB,
				projectId: this.options.projectId,
				target: workflowId,
				payload: batch,
				origin: { triggerId: batch.triggerId, source: batch.source },
				enqueuedAt: new Date().toISOString(),
			};
			await this.options.run(job);
		}
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
	private ackWaitFor(artifact: TriggerArtifact) {
		// The slowest linked workflow sets the wait: the batch is not done until
		// every job derived from it has been handed over.
		const seconds = Math.max(
			0,
			...artifact.workflowIds.map(
				(id) => this.options.workflowTimeoutSeconds?.(id) ?? 0,
			),
		);
		if (!seconds) return this.options.defaultAckWaitMs;
		return seconds * 1000 + ACK_WAIT_MARGIN_MS;
	}
}

/** The internal path carries one event, so its bound is the payload cap plus slack. */
const MAX_INTERNAL_BATCH_BYTES = 1024 * 1024;
/** Room for the trip to the execution process, on top of the workflow's budget. */
const ACK_WAIT_MARGIN_MS = 30_000;

function unchanged(a: TriggerArtifact, b: TriggerArtifact) {
	return (
		a.workflowIds.join() === b.workflowIds.join() &&
		a.batchSize === b.batchSize &&
		a.maxWaitMs === b.maxWaitMs &&
		a.maxBytes === b.maxBytes &&
		a.concurrency === b.concurrency &&
		a.type === b.type &&
		a.integrationId === b.integrationId
	);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}
