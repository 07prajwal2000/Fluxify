import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { systemUsers } from "../../db/auth-schema";
import { projectBackupsEntity } from "../../db/schema";

/** the rows of `project_backups` (#1103); #1106 reads and writes the same ones */
type Row = typeof projectBackupsEntity.$inferSelect;

/** a `running` row older than this belongs to a run that died with its process */
export const STALE_AFTER_MS = 60 * 60_000;
export const INTERRUPTED = "The backup was interrupted (the server restarted). Start it again.";

export const insertBackup = async (
	values: typeof projectBackupsEntity.$inferInsert,
	tx: DbTransactionType | typeof db = db,
) => (await tx.insert(projectBackupsEntity).values(values).returning())[0]!;

export const finishBackup = (id: string, set: Partial<Row>) =>
	db
		.update(projectBackupsEntity)
		.set({ ...set, finishedAt: new Date() })
		.where(eq(projectBackupsEntity.id, id));

export async function findBackup(projectId: string, id: string) {
	const [row] = await db
		.select()
		.from(projectBackupsEntity)
		.where(and(eq(projectBackupsEntity.projectId, projectId), eq(projectBackupsEntity.id, id)));
	return row;
}

/** newest first, with who started each */
export const listBackups = (projectId: string, limit = 100) =>
	db
		.select({
			backup: projectBackupsEntity,
			createdByEmail: systemUsers.email,
			createdByName: systemUsers.name,
		})
		.from(projectBackupsEntity)
		.leftJoin(systemUsers, eq(systemUsers.id, projectBackupsEntity.createdBy))
		.where(eq(projectBackupsEntity.projectId, projectId))
		.orderBy(desc(projectBackupsEntity.createdAt))
		.limit(limit);

/**
 * Serialises starting a backup of one project across admin replicas (#1106):
 * the check for a running one and the insert happen under this lock, which is
 * held until the transaction ends.
 */
export const lockProjectBackups = (tx: DbTransactionType, projectId: string) =>
	tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`project-backup:${projectId}`}))`);

/** a backup of this project that is still going */
export async function hasRunning(projectId: string, tx: DbTransactionType | typeof db = db) {
	const [row] = await tx
		.select({ id: projectBackupsEntity.id })
		.from(projectBackupsEntity)
		.where(
			and(
				eq(projectBackupsEntity.projectId, projectId),
				eq(projectBackupsEntity.status, "running"),
				sql`${projectBackupsEntity.createdAt} > ${new Date(Date.now() - STALE_AFTER_MS)}`,
			),
		)
		.limit(1);
	return Boolean(row);
}

/** the newest object storage run of a project, `succeeded` only when asked */
export async function lastStorageRun(
	projectId: string,
	succeeded = false,
	tx: DbTransactionType | typeof db = db,
) {
	const [row] = await tx
		.select()
		.from(projectBackupsEntity)
		.where(
			and(
				eq(projectBackupsEntity.projectId, projectId),
				eq(projectBackupsEntity.type, "object_storage"),
				succeeded ? eq(projectBackupsEntity.status, "succeeded") : undefined,
			),
		)
		.orderBy(desc(projectBackupsEntity.createdAt))
		.limit(1);
	return row;
}

/** runs whose process is gone: failed, so the table stops showing them as running */
export const failStaleRuns = (now = new Date()) =>
	db
		.update(projectBackupsEntity)
		.set({ status: "failed", error: INTERRUPTED, finishedAt: now })
		.where(
			and(
				eq(projectBackupsEntity.status, "running"),
				lt(projectBackupsEntity.createdAt, new Date(now.getTime() - STALE_AFTER_MS)),
			),
		)
		.returning({ id: projectBackupsEntity.id });

/** manual archives still held that finished before `cutoff` */
export const expiredArchives = (cutoff: Date) =>
	db
		.select({ id: projectBackupsEntity.id, key: projectBackupsEntity.destinationKey })
		.from(projectBackupsEntity)
		.where(
			and(
				eq(projectBackupsEntity.type, "manual"),
				isNotNull(projectBackupsEntity.destinationKey),
				lt(projectBackupsEntity.finishedAt, cutoff),
			),
		);

export const forgetArchive = (id: string) =>
	db
		.update(projectBackupsEntity)
		.set({ destinationKey: null })
		.where(eq(projectBackupsEntity.id, id));
