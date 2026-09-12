import type { Next } from "hono";
import { getEnv } from "../../lib/env";
import { NotFoundError } from "../../errors/notFoundError";
import type { HonoContext } from "../../types";

/**
 * Whether this deployment has an orchestrator at all (§5a).
 *
 * A **deployment-shape** flag, not a license one, and the two are independent:
 * Kit is admin, worker and everything else in one process tree with no
 * orchestrator to speak of, so a Kit instance holding an enterprise key still
 * has nothing to claim nodes from. Nothing is lost there — one container is one
 * node, there is no placement decision to make.
 *
 * It gates the endpoints and not only the UI. A hidden control with a live
 * endpoint behind it is not gated.
 */
export function orchestrationEnabled(): boolean {
	return getEnv("ENABLE_ORCHESTRATION") !== "false";
}

/**
 * 404 rather than 403: on a Kit build these routes do not exist, and saying
 * "forbidden" would imply a permission someone could be granted.
 */
export async function requireOrchestration(_ctx: HonoContext, next: Next) {
	if (!orchestrationEnabled()) throw new NotFoundError("Orchestration is not available on this deployment");
	return next();
}
