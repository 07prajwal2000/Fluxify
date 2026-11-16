import { eq } from "drizzle-orm";
import { db } from "../../db";
import { projectBackupsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { canRunStorageBackups } from "../../lib/edition";
import { audit } from "../audit";
import { requestProjectCompile } from "../compiler/publisher";
import { hasRunning, insertBackup, lockProjectBackups } from "./history";
import { BACKUP_MODULES } from "./modules";
import { SCHEDULE_OFF_WARNING } from "./resources/projectSettings";
import { readBackup, restoreBackup } from "./restore";
import { COMPILE_NOT_QUEUED, summaryOf } from "./restoreProject";
import { activeConflicts, previewRollback } from "./rollbackPreview";
import { runBackup } from "./run";
import { readSchedule } from "./schedule";
import { storageDestination } from "./storageDestination";

/**
 * Rolling a project back to a backup, in place (#1130). Matching is by name
 * per section: a match is updated and keeps its id, what only the backup has is
 * created, and what only the project has is kept or (exact replica) removed,
 * in the sections chosen only. A normal backup of the project is taken first;
 * if it fails, nothing is changed.
 */

/** how the safety net shows in the backup history */
export const BEFORE_ROLLBACK = "Before rollback";

export type RollbackChoice = {
	/** the archive's sections to restore; the rest of the project is left alone */
	sections: string[];
	/** exact replica: remove what those sections' backup lacks */
	prune: boolean;
	/** a backup's credentials and app config values over today's */
	restoreSecrets: boolean;
};

/** what the archive holds and what rolling back to it would change; writes nothing */
export async function inspectRollback(projectId: string, bytes: Uint8Array) {
	const plan = await readBackup(bytes, BACKUP_MODULES);
	const { warnings, ...rollback } = await previewRollback(plan, projectId);
	return { ...summaryOf(plan), warnings, rollback };
}

/**
 * A full backup of the project as it is now, all sections and version history,
 * to the project's bucket when backups to object storage are set up and
 * licensed (as "Back up now"), otherwise downloadable from the history. Throws
 * when it fails: the rollback must not start without it.
 */
export async function backUpBeforeRollback(projectId: string, userId: string | null) {
	const { schedule } = await readSchedule(projectId);
	const { integrationId, prefix, retention } = schedule;
	const toBucket = Boolean(integrationId && prefix) && canRunStorageBackups();
	const row = await db.transaction(async (tx) => {
		await lockProjectBackups(tx, projectId);
		if (await hasRunning(projectId, tx))
			throw new ConflictError(
				"A backup of this project is running. Wait for it to finish, then roll back.",
			);
		return await insertBackup(
			{
				projectId,
				type: toBucket ? "object_storage" : "manual",
				mode: "backup",
				sections: BACKUP_MODULES.map((m) => m.name),
				label: BEFORE_ROLLBACK,
				createdBy: userId,
			},
			tx,
		);
	});
	const options = { includeVersionHistory: true, includeAppConfigValues: true };
	await runBackup(
		row,
		{ options },
		toBucket
			? storageDestination(row, { integrationId: integrationId!, prefix, retention })
			: undefined,
	);
	const [done] = await db
		.select({ status: projectBackupsEntity.status, error: projectBackupsEntity.error })
		.from(projectBackupsEntity)
		.where(eq(projectBackupsEntity.id, row.id));
	if (done?.status !== "succeeded")
		throw new BadRequestError(
			`The backup taken before rolling back failed, so nothing was changed: ${done?.error ?? "it did not finish"}`,
		);
	return row.id;
}

/**
 * Rolls the project back to the archive. Every check comes first (the archive,
 * the choices, what an exact replica would break), then the safety backup,
 * then one transaction under the project's backup lock, so a scheduled backup
 * never captures half a rollback. Compile, trigger republishing and removed
 * triggers' unregistering run after the commit; their failures are warnings.
 */
export async function rollbackProject(
	projectId: string,
	bytes: Uint8Array,
	choice: RollbackChoice,
	userId: string | null,
) {
	const plan = await readBackup(bytes, BACKUP_MODULES);
	const held = new Set(plan.sections.map((s) => s.module.name));
	const sections = [...new Set(choice.sections)];
	const missing = sections.find((s) => !held.has(s));
	if (missing) throw new BadRequestError(`This backup has no "${missing}" section to restore.`);
	if (!sections.length) throw new BadRequestError("Choose at least one section to restore.");
	const preview = await previewRollback(plan, projectId);
	const refused = activeConflicts(preview.conflicts, choice.prune, sections);
	if (refused.length) throw new BadRequestError(refused.map((c) => c.message).join(" "));

	const backupId = await backUpBeforeRollback(projectId, userId);
	const { warnings } = await restoreBackup(
		plan,
		(work) =>
			db.transaction(async (tx) => {
				await lockProjectBackups(tx, projectId);
				if (await hasRunning(projectId, tx))
					throw new ConflictError(
						"A backup of this project started meanwhile. Wait for it to finish, then roll back.",
					);
				await work(tx, projectId);
				await audit.record({
					projectId,
					resourceType: "project",
					resourceId: projectId,
					action: "restore",
					changedFields: [choice.prune ? "exact" : "keep", ...sections],
				});
				return projectId;
			}),
		{ ...choice, sections },
	);
	if (!(await requestProjectCompile(projectId, "project rolled back")))
		warnings.push({ section: "project", message: COMPILE_NOT_QUEUED });
	// the rollback leaves the project's own scheduled backups as they are
	return { backupId, warnings: warnings.filter((w) => w.message !== SCHEDULE_OFF_WARNING) };
}
