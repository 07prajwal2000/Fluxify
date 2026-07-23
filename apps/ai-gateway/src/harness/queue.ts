import { Queue, QueueEvents } from "bullmq";
import { EventEmitter } from "events";
import { logger } from "@fluxify/common";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import type { HitlPlanAction } from "./internal/harnessService";
import type { HarnessStreamEvent } from "./streamTypes";

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
export let harnessQueueEvents: QueueEvents = null!;
/** Local fan-out for SSE streams, keyed by conversationId. BullMQ QueueEvents is
 *  a single connection, so we re-emit progress locally for multiple clients. */
export let harnessEventEmitter: EventEmitter = null!;

let initialized = false;

export function initializeHarnessQueue() {
	if (initialized) return;

	harnessQueue = new Queue<HarnessJobData>(HARNESS_QUEUE_NAME, {
		connection: connection(),
	});
	harnessQueueEvents = new QueueEvents(HARNESS_QUEUE_NAME, {
		connection: connection(),
	});
	harnessEventEmitter = new EventEmitter();
	// Allow many concurrent SSE subscribers per process.
	harnessEventEmitter.setMaxListeners(0);

	harnessQueueEvents.on("progress", (args) => {
		const event = args.data as unknown as HarnessStreamEvent;
		if (event?.conversationId) {
			harnessEventEmitter.emit(event.conversationId, event);
		}
	});

	initialized = true;
	logger.info("[HarnessQueue] Initialized");
}
