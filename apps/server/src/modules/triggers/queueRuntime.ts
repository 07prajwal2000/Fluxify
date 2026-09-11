import {
	QueueConnectionManager,
	registerQueueConnector,
	type QueueBatch,
	type QueueConnection,
} from "@fluxify/adapters";
import type { TriggerConnection, TriggerEvent, TriggerSource } from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { findIntegrationConfig, ownsIntegration } from "../../loaders/integrationsLoader";
import type { TriggerArtifact } from "../compiler/artifacts";
import { compiledWorkflow } from "../requestRouter/compiledRuntime";
import { runWorkflowJob } from "../jobs/workflowJob";
import { WORKFLOW_JOB } from "../jobs/subjects";
import type { JobEnvelope } from "../jobs/types";
import { consumedInExecution, type TriggerBatch } from "./types";

/**
 * External queue triggers, consumed inside the execution process.
 *
 * The supervisor decides which triggers run by forwarding their artifacts; this
 * holds the connections and runs each batch straight into its workflow, with no
 * copy onto the internal broker. What happens to a batch afterwards is decided
 * here, per trigger:
 *
 * - success: committed, unless the trigger commits manually.
 * - failure: run again, up to `maxAttempts`. A run the graph's error handler
 *   settles is a success; only an unhandled error counts.
 * - still failing: in auto mode it is moved to the integration's dead-letter
 *   destination and committed. In manual mode it is left uncommitted for the
 *   connector to deliver again — the workflow owns its offsets.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

registerQueueConnector("kafka", () => import("@fluxify/adapters/queue/kafka"));
registerQueueConnector("nats", () => import("@fluxify/adapters/queue/nats"));

const manager = new QueueConnectionManager();
/** The artifact each running trigger was started from, read per batch. */
const triggers = new Map<string, TriggerArtifact>();

/** A trigger artifact arriving, changing or being withdrawn. */
export async function applyQueueTrigger(triggerId: string, artifact: TriggerArtifact | null) {
	if (artifact && !consumedInExecution(artifact.type)) return;
	if (!artifact) {
		triggers.delete(triggerId);
		return manager.stop(triggerId);
	}
	triggers.set(triggerId, artifact);
	return startTrigger(artifact);
}

/**
 * Re-reads every trigger's credentials after project config changed. Unchanged
 * ones are left alone; a rotated or deleted integration restarts or stops.
 */
export function refreshQueueTriggers() {
	return Promise.allSettled([...triggers.values()].map(startTrigger));
}

export async function shutdownQueueTriggers() {
	triggers.clear();
	await manager.close();
}

export function hasQueueTrigger(triggerId: string) {
	return manager.has(triggerId);
}

async function startTrigger(artifact: TriggerArtifact) {
	const config = artifact.integrationId
		? findIntegrationConfig(artifact.integrationId)
		: undefined;
	// An id alone would let one project's trigger borrow another's credentials.
	if (!ownsIntegration(config, artifact.projectId)) {
		logger.warn(
			`[triggers] no usable integration for ${artifact.triggerId}, not consuming`,
			"TRIGGERS.queue",
		);
		return manager.stop(artifact.triggerId);
	}
	try {
		await manager.start(
			artifact.triggerId,
			{
				type: artifact.type,
				config,
				subscription: {
					source: artifact.source ?? {},
					consumerGroup: `fluxify-${artifact.triggerId}`,
					batchSize: artifact.batchSize,
					maxWaitMs: artifact.maxWaitMs,
					maxBytes: artifact.maxBytes,
					concurrency: artifact.concurrency,
				},
			},
			(batch, connection) => runBatch(artifact.triggerId, batch, connection),
		);
	} catch (error) {
		logger.error(
			`[triggers] consumer for ${artifact.triggerId} failed to start: ${String(error)}`,
			"TRIGGERS.queue",
		);
	}
}

/** Exported for tests; the connector is the only other caller. */
export async function runBatch(
	triggerId: string,
	batch: QueueBatch,
	connection: QueueConnection,
) {
	// Read per batch, so a workflow or commit-mode change applies without a restart.
	const artifact = triggers.get(triggerId);
	// Neither is a failure of the batch: throwing leaves it uncommitted for the
	// next consumer rather than spending its attempts or dead-lettering it.
	if (!artifact) throw new Error(`trigger ${triggerId} is no longer running`);
	if (!compiledWorkflow(artifact.workflowId)) {
		throw new Error(`workflow ${artifact.workflowId} is not loaded on this worker`);
	}

	const manual = artifact.commitMode === "manual";
	const maxAttempts = Math.max(1, artifact.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
	const retryDelayMs = artifact.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
	let failure: unknown;
	for (let attempt = batch.attempt; attempt <= maxAttempts; attempt++) {
		const current = { ...batch, attempt };
		try {
			await runWorkflowJob(jobFor(artifact, current), {
				connection: bindConnection(connection, current),
				meta: {
					consumerGroup: current.consumerGroup,
					highWatermark: current.highWatermark,
					attempt,
				},
			});
			if (!manual) await connection.commit(current);
			return;
		} catch (error) {
			failure = error;
			logger.warn(
				`[triggers] ${triggerId} batch failed (attempt ${attempt}/${maxAttempts}): ${String(error)}`,
				"TRIGGERS.queue",
			);
			if (attempt < maxAttempts) await Bun.sleep(retryDelayMs);
		}
	}

	if (manual) throw failure;
	// A dead-letter failure throws past the commit: losing the batch is worse
	// than running it again.
	await connection.moveToDLQ(batch, failure);
	await connection.commit(batch);
}

function jobFor(artifact: TriggerArtifact, batch: QueueBatch): JobEnvelope {
	const source = artifact.type as TriggerSource;
	return {
		id: crypto.randomUUID(),
		kind: WORKFLOW_JOB,
		projectId: artifact.projectId,
		target: artifact.workflowId,
		payload: {
			triggerId: artifact.triggerId,
			source,
			events: batch.events.map(
				({ data, ...meta }): TriggerEvent => ({
					data,
					meta: {
						...meta,
						// the position in the log is the event's identity
						id: `${meta.topic}:${meta.partition}:${meta.offset}`,
						receivedAt: meta.timestamp,
						source,
					},
				}),
			),
		} satisfies TriggerBatch,
		origin: { triggerId: artifact.triggerId, source },
		enqueuedAt: new Date().toISOString(),
		attempt: batch.attempt,
	};
}

function bindConnection(connection: QueueConnection, batch: QueueBatch): TriggerConnection {
	const bound = {
		commit: () => connection.commit(batch),
		moveToDLQ: (error: unknown) => connection.moveToDLQ(batch, error),
		lag: () => connection.lag(),
	} as TriggerConnection;
	// the client is cyclic: hidden from JSON.stringify so logging `trigger` works
	return Object.defineProperty(bound, "raw", { value: connection.raw(), enumerable: false });
}
