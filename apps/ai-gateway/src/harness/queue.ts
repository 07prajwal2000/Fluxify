import { Queue } from "bullmq";
import { logger } from "@fluxify/common";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import type { HitlPlanAction } from "./internal/harnessService";

export const HARNESS_QUEUE_NAME = "AGENT_HARNESS_QUEUE";
export const HARNESS_START_JOB = "HARNESS_START_JOB";
export const HARNESS_CONTINUE_JOB = "HARNESS_CONTINUE_JOB";

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

let initialized = false;

export function initializeHarnessQueue() {
	if (initialized) return;

	harnessQueue = new Queue<HarnessJobData>(HARNESS_QUEUE_NAME, {
		connection: connection(),
	});

	initialized = true;
	logger.info("Initialized", "HarnessQueue");
}
