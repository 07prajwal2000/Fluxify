import { logger } from "@fluxify/common";
import { listActiveScheduledTriggers } from "../api/v1/triggers/repository";
import { ENVIRONMENTS } from "../lib/envValues";
import { reconcileSchedules } from "../modules/schedules/reconciler";

/**
 * Puts the broker's schedules back in step with the database at boot.
 *
 * This runs on the node that owns the database connection, and it is the only
 * thing that repairs the two ways NATS and Postgres drift apart: a schedule
 * that was never written (a wiped JetStream volume, a trigger created while the
 * broker was unreachable) and one that should no longer exist (a trigger
 * deleted while this process was down). Both are silent — a trigger that never
 * fires, and one that fires forever — so neither shows up without being looked
 * for.
 *
 * Both environments are reconciled (#738). A schedule lives in the NATS
 * namespace of every environment its workflow is live in, so each environment
 * gets its own list of what belongs there and its own orphan sweep; a schedule
 * that is only in development is not an orphan to production's pass.
 *
 * A failure here does not stop the server: the API still has to serve, and the
 * next boot reconciles again.
 */
export async function loadSchedules() {
	try {
		for (const env of ENVIRONMENTS) {
			const triggers = await listActiveScheduledTriggers(env);
			await reconcileSchedules(
				triggers.map((row) => ({
					id: row.id,
					projectId: row.projectId,
					workflowId: row.workflowId,
					schedule: row.schedule!,
					timezone: row.timezone,
					payload: row.payload ?? undefined,
				})),
				env,
			);
		}
	} catch (error) {
		logger.error(`[schedules] reconcile failed: ${String(error)}`, "SCHEDULES");
	}
}
