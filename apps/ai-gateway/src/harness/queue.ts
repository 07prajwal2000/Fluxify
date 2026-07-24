import { Queue } from "bullmq";
import { EventEmitter } from "events";
import { logger } from "@fluxify/common";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import type { HitlPlanAction } from "./internal/harnessService";

export const HARNESS_QUEUE_NAME = "AGENT_HARNESS_QUEUE";
export const HARNESS_START_JOB = "HARNESS_START_JOB";
export const HARNESS_CONTINUE_JOB = "HARNESS_CONTINUE_JOB";

export interface HarnessJobMetadata {
	projectId?: string;
	userId?: string;
	location?: string;
	routeId?: string;
}

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
}

function connection() {
	return {
		host: REDIS_HOST,
		port: parseInt(REDIS_PORT),
		password: REDIS_PASS,
		username: REDIS_USER,
	};
}

export let harnessQueue: Queue<HarnessJobData> = null!;
/** In-process fan-out for live subscribers (SSE today, socket.io next), keyed by
 *  conversationId. Fed from the NATS `conversations.*` subscriber, not BullMQ —
 *  see notifications.startConversationEventBridge. */
export let harnessEventEmitter: EventEmitter = null!;

let initialized = false;

export function initializeHarnessQueue() {
	if (initialized) return;

	harnessQueue = new Queue<HarnessJobData>(HARNESS_QUEUE_NAME, {
		connection: connection(),
	});
	harnessEventEmitter = new EventEmitter();
	// Allow many concurrent subscribers per process.
	harnessEventEmitter.setMaxListeners(0);

	initialized = true;
	logger.info("Initialized", "HarnessQueue");
}
