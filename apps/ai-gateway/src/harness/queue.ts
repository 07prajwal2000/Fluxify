import { logger } from "@fluxify/common";
import {
	ensureStreamConsumer,
	natsConnection,
	publishToStream,
	type ConsumerSpec,
	type StreamSpec,
} from "@fluxify/common/nats";
import type { HitlPlanAction } from "./internal/harnessService";

/**
 * Harness jobs travel on a JetStream work queue. Requests survive a gateway
 * restart, several gateway replicas share one durable consumer (that is the
 * load balancing), and a run is handled exactly once.
 */

export const HARNESS_STREAM = "FLUXIFY_HARNESS";
export const HARNESS_CONSUMER = "fluxify_harness";

const SUBJECT_ROOT = "fluxify.harness";
/** everything the harness worker consumes */
export const HARNESS_SUBJECTS = [`${SUBJECT_ROOT}.>`];

export const harnessStartSubject = (conversationId: string) =>
	`${SUBJECT_ROOT}.start.${conversationId}`;
export const harnessContinueSubject = (conversationId: string) =>
	`${SUBJECT_ROOT}.continue.${conversationId}`;

export const HARNESS_STREAM_SPEC: StreamSpec = {
	name: HARNESS_STREAM,
	subjects: HARNESS_SUBJECTS,
	// work queue: a job is removed once acked, so a restart never replays
	retention: "workqueue",
	maxAgeMs: 60 * 60_000,
	// Guards a *retried publish* of one intent. It is not what stops a second
	// run on a conversation — the two DB claims do that (see enqueue.ts).
	duplicateWindowMs: 2 * 60_000,
};

export const HARNESS_CONSUMER_SPEC: ConsumerSpec = {
	durable: HARNESS_CONSUMER,
	// A run is expensive and not idempotent: replaying one from the top after a
	// worker dies would re-spend the tokens and re-emit every step. The user
	// re-sends instead. Acking on dispatch (see worker.ts) makes this explicit.
	maxDeliver: 1,
	// Only covers the window between delivery and the dispatch ack, not the run.
	ackWaitMs: 30_000,
};

export interface HarnessJobMetadata {
	projectId?: string;
	userId?: string;
	/** AI integration to drive this run. Falls back to the project default when
	 *  absent. See resolveAgentOptionsFromIntegrationId. */
	integrationId?: string;
	/** Resource the user was viewing when they sent this message, if any. */
	location?: { where: "route-canvas" | "custom-block-canvas"; id: string };
	/** Which human gates this run stops at. See `ApplyMode`. */
	applyMode?: ApplyMode;
}

/**
 * How much of the run the user wants to sign off on.
 *
 * - `manual` (default, and the behaviour that existed before this was a choice):
 *   the planner decides whether the plan needs review, and every artifact is
 *   applied by hand.
 * - `plan`: the plan ALWAYS halts for human review, however confident the
 *   planner is. Applying is still manual.
 * - `auto`: no gates. The plan never halts, and the run's artifacts are applied
 *   as soon as it finishes.
 */
export type ApplyMode = "manual" | "plan" | "auto";

export const DEFAULT_APPLY_MODE: ApplyMode = "manual";

/**
 * Job payload for the harness queue.
 *
 * - `start`: fresh run for `query`.
 * - `continue`: resume a parked (awaiting_hitl) run. `action` carries the user's
 *   HITL decision — for a plan review this includes the array of review comments
 *   (`{ type: "review", comments: string[] }`), or approve / reject.
 */
export interface HarnessJobData {
	type: "start" | "continue";
	conversationId: string;
	runId: string;
	query?: string;
	action?: HitlPlanAction;
	metadata?: HarnessJobMetadata;
	/** `Nats-Msg-Id` of this publish; carried for log correlation. */
	idempotencyKey?: string;
}

let initialized = false;

/** Declares the stream + durable consumer. Idempotent; called from both the
 *  API thread (publisher) and the worker thread (consumer). */
export async function initializeHarnessQueue() {
	if (initialized) return;
	await ensureStreamConsumer(
		natsConnection(),
		HARNESS_STREAM_SPEC,
		HARNESS_CONSUMER_SPEC,
	);
	initialized = true;
	logger.info("Initialized", "HarnessQueue");
}

/**
 * Publishes one harness job. `msgId` is the broker's dedupe key inside the
 * stream's duplicate window: a retried publish of the same intent enqueues the
 * work once.
 */
export async function publishHarnessJob(
	subject: string,
	data: HarnessJobData,
	options: { msgId?: string } = {},
) {
	await publishToStream(natsConnection(), subject, data, options);
}
