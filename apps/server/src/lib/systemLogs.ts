import { logger } from "@fluxify/common";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import { systemLogsEntity } from "../db/schema";

/**
 * Logs meant for the UI (project logs, compile status), not stdout. Writing one
 * never throws: a broken log write must not break the work it describes. One row
 * per `type` + resource; writing again overwrites it. `runtime` is the exception:
 * one row per failed run, appended, and deleted with its recording (#731).
 */

/** appended, never upserted */
export const RUNTIME_LOG_TYPE = "runtime";

export type SystemLogLevel = (typeof systemLogsEntity.$inferInsert)["level"];

export type SystemLogEntry = {
	projectId?: string | null;
	resourceType: string;
	resourceId: string;
	type: string;
	message: string;
	detail?: Record<string, unknown>;
	/** the recording a `runtime` entry belongs to */
	runId?: string;
};

export type SystemLogFilter = {
	projectId: string;
	resourceType?: string;
	resourceId?: string;
	type?: string;
	level?: SystemLogLevel;
	limit?: number;
};

async function write(level: SystemLogLevel, entry: SystemLogEntry) {
	const row = { ...entry, level, detail: entry.detail ?? null };
	try {
		const insert = db.insert(systemLogsEntity).values(row);
		if (entry.type === RUNTIME_LOG_TYPE) await insert;
		else {
			await insert.onConflictDoUpdate({
				target: [systemLogsEntity.type, systemLogsEntity.resourceId, systemLogsEntity.resourceType],
				// the unique index is partial, so the conflict target must repeat its predicate
				targetWhere: sql`${systemLogsEntity.type} <> 'runtime'`,
				set: { ...row, updatedAt: sql`now()` },
			});
		}
	} catch (error) {
		logger.error(`[system-log] failed to write: ${entry.message}`, "SYSTEM_LOG", { error });
	}
}

export const systemLog = {
	info: (entry: SystemLogEntry) => write("info", entry),
	warn: (entry: SystemLogEntry) => write("warn", entry),
	error: (entry: SystemLogEntry) => write("error", entry),
};

/** most recently written first */
// ponytail: no paging; add a cursor when a project logs page needs more than `limit`
export async function listSystemLogs(filter: SystemLogFilter) {
	const where: SQL[] = [eq(systemLogsEntity.projectId, filter.projectId)];
	if (filter.resourceType) where.push(eq(systemLogsEntity.resourceType, filter.resourceType));
	if (filter.resourceId) where.push(eq(systemLogsEntity.resourceId, filter.resourceId));
	if (filter.type) where.push(eq(systemLogsEntity.type, filter.type));
	if (filter.level) where.push(eq(systemLogsEntity.level, filter.level));

	return db
		.select()
		.from(systemLogsEntity)
		.where(and(...where))
		.orderBy(desc(systemLogsEntity.updatedAt))
		.limit(filter.limit ?? 50);
}
