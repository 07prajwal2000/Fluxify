import { logger } from "@fluxify/common";
import { inArray, lt } from "drizzle-orm";
import { db } from "../../db";
import { auditEventsEntity } from "../../db/schema";
import { AUDIT_LOG_MAX_AGE_DAYS } from "../../lib/env";

/** rows per delete, so one tick never holds a long lock */
const BATCH = 5000;

/**
 * Deletes events older than `maxAgeDays`, a batch at a time. Idempotent: a
 * missed tick is covered by the next one. Runs whatever the licence says, so
 * rows age out after a lapse; they stay readable until then.
 */
export async function deleteExpiredAuditEvents(maxAgeDays = AUDIT_LOG_MAX_AGE_DAYS) {
	const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60_000);
	let deleted = 0;
	for (;;) {
		const batch = db
			.select({ id: auditEventsEntity.id })
			.from(auditEventsEntity)
			.where(lt(auditEventsEntity.ts, cutoff))
			.limit(BATCH);
		const rows = await db
			.delete(auditEventsEntity)
			.where(inArray(auditEventsEntity.id, batch))
			.returning({ id: auditEventsEntity.id });
		deleted += rows.length;
		if (rows.length < BATCH) break;
	}
	if (deleted) {
		logger.info(`[audit] deleted ${deleted} event(s) older than ${maxAgeDays} days`, "AUDIT");
	}
	return deleted;
}
