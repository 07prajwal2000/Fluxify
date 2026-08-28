import type { HarnessJobMetadata } from "../queue";
import type { HitlPlanAction } from "./harnessService";

/** Everything one harness pass needs to identify and describe itself. Lives
 *  apart from `FluxifyHarness` so the run's collaborators can take it without
 *  importing the class back. */
export interface HarnessRunContext {
	conversationId: string;
	runId: string;
	query?: string;
	action?: HitlPlanAction;
	metadata?: HarnessJobMetadata;
}
