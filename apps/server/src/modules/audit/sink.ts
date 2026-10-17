import { db } from "../../db";
import { auditEventsEntity } from "../../db/schema";
import type { AuditEvent, AuditSink } from "./types";

/** Postgres rows per INSERT; 14 columns keep a statement far under the parameter limit. */
const CHUNK = 500;

/** The Postgres sink. The event id is the key, so a redelivered batch writes nothing twice. */
export const postgresAuditSink: AuditSink = {
	async insert(batch) {
		for (let i = 0; i < batch.length; i += CHUNK) {
			await db
				.insert(auditEventsEntity)
				.values(batch.slice(i, i + CHUNK).map(toRow))
				.onConflictDoNothing({ target: auditEventsEntity.id });
		}
	},
};

const toRow = (e: AuditEvent) => ({ ...e, ts: new Date(e.ts), message: e.message ?? null });
