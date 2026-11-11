import { logger } from "@fluxify/common";
import { and, desc, eq, lt, notInArray, type SQL, sql } from "drizzle-orm";
import { db } from "../db";
import { sandboxesEntity, systemLogsEntity } from "../db/schema";
import { olap } from "../modules/olap";
import { chListLogs, chWriteLog } from "../modules/olap/systemLogs";

/**
 * Logs meant for the UI (project logs, compile status), not stdout. Writing one
 * never throws: a broken log write must not break the work it describes. One row
 * per `type` + resource; writing again overwrites it. `runtime` is the exception:
 * one row per failed run, appended, and deleted with its recording (#731).
 */

/** appended, never upserted */
export const RUNTIME_LOG_TYPE = "runtime";
/**
 * One row per ephemeral run (#741), appended like `runtime`. It has no recording
 * to hang off, so it carries its owner in `detail.userId` and is removed by age.
 */
export const EPHEMERAL_LOG_TYPE = "ephemeral";

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
	/** rows of this environment; rows with no env (compile, orchestrator) match both */
	env?: "development" | "production";
	limit?: number;
};

async function write(level: SystemLogLevel, entry: SystemLogEntry) {
	const row = { ...entry, level, detail: entry.detail ?? null };
	try {
		const appended = entry.type === RUNTIME_LOG_TYPE || entry.type === EPHEMERAL_LOG_TYPE;
		// appended rows are OLAP data (#760); upserted ones stay in Postgres
		const ch = olap();
		if (appended && ch) return await chWriteLog(ch, row);
		const insert = db.insert(systemLogsEntity).values(row);
		if (appended) await insert;
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

/**
 * Retention for ephemeral runs' rows (#741): they have no recording to cascade
 * from, so the recordings cleanup job removes them by age instead.
 */
export async function deleteExpiredEphemeralLogs(cutoff: Date) {
	const rows = await db
		.delete(systemLogsEntity)
		.where(
			and(eq(systemLogsEntity.type, EPHEMERAL_LOG_TYPE), lt(systemLogsEntity.updatedAt, cutoff)),
		)
		.returning({ id: systemLogsEntity.id });
	return rows.length;
}

/** most recently written first */
// ponytail: no paging; add a cursor when a project logs page needs more than `limit`
export async function listSystemLogs(filter: SystemLogFilter, userId: string) {
	const ch = olap();
	if (!ch) return listPostgresLogs(filter, userId);
	// #760: appended types live in ClickHouse, upserted ones in Postgres; merge both
	const appended = [RUNTIME_LOG_TYPE, EPHEMERAL_LOG_TYPE];
	const limit = filter.limit ?? 50;
	const wantsOlap = !filter.type || appended.includes(filter.type);
	const wantsPg = !filter.type || !appended.includes(filter.type);
	const sandboxIds = wantsOlap
		? (
				await db
					.select({ id: sandboxesEntity.id })
					.from(sandboxesEntity)
					.where(eq(sandboxesEntity.userId, userId))
			).map((r) => r.id)
		: [];
	const [pg, olapRows] = await Promise.all([
		wantsPg ? listPostgresLogs(filter, userId, appended) : [],
		wantsOlap ? chListLogs(ch, { ...filter, limit, userId, sandboxIds }) : [],
	]);
	return [...pg, ...olapRows]
		.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
		.slice(0, limit);
}

async function listPostgresLogs(
	filter: SystemLogFilter,
	userId: string,
	excludeTypes: string[] = [],
) {
	const where: SQL[] = [
		eq(systemLogsEntity.projectId, filter.projectId),
		// a sandbox's logs are its owner's alone (#735)
		sql`(${systemLogsEntity.resourceType} <> 'sandbox' OR ${systemLogsEntity.resourceId} IN (SELECT ${sandboxesEntity.id} FROM ${sandboxesEntity} WHERE ${sandboxesEntity.userId} = ${userId}))`,
		// so is an ephemeral run's (#741)
		sql`(${systemLogsEntity.type} <> ${EPHEMERAL_LOG_TYPE} OR ${systemLogsEntity.detail}->>'userId' = ${userId})`,
	];
	if (excludeTypes.length) where.push(notInArray(systemLogsEntity.type, excludeTypes));
	if (filter.resourceType) where.push(eq(systemLogsEntity.resourceType, filter.resourceType));
	if (filter.resourceId) where.push(eq(systemLogsEntity.resourceId, filter.resourceId));
	if (filter.type) where.push(eq(systemLogsEntity.type, filter.type));
	if (filter.level) where.push(eq(systemLogsEntity.level, filter.level));
	if (filter.env)
		where.push(
			sql`(${systemLogsEntity.detail}->>'env' IS NULL OR ${systemLogsEntity.detail}->>'env' = ${filter.env})`,
		);

	return db
		.select()
		.from(systemLogsEntity)
		.where(and(...where))
		.orderBy(desc(systemLogsEntity.updatedAt))
		.limit(filter.limit ?? 50);
}
