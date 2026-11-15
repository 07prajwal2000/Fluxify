import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { type projectBackupsEntity, projectsEntity } from "../../db/schema";
import { CustomError } from "../../errors/customError";
import { archiveKey, deleteArchive, putArchive } from "./archives";
import { createBackup } from "./backup";
import { finishBackup } from "./history";
import { BACKUP_MODULES } from "./modules";
import type { BackupOptions } from "./types";

type Row = typeof projectBackupsEntity.$inferSelect;

/** what the history shows when a run fails: our own errors say what to do, anything else is generic */
const reason = (error: unknown) =>
	error instanceof CustomError
		? error.message
		: "The backup failed unexpectedly. Check the server log, then try again.";

/**
 * One backup, start to finish, on this admin process (it holds the database
 * connection; workers never do). Never throws: the outcome lands on the row.
 * The archive is stored only once it is complete, and removed again if the row
 * can't be updated, so a failed run leaves no file.
 */
export async function runBackup(row: Row, input: { options: BackupOptions; readme?: string }) {
	const key = archiveKey(row.projectId, row.id);
	try {
		const [project] = await db
			.select({ name: projectsEntity.name, slug: projectsEntity.slug })
			.from(projectsEntity)
			.where(eq(projectsEntity.id, row.projectId));
		if (!project) throw new Error("the project is gone");
		const { bytes, manifest } = await createBackup(
			{
				projectId: row.projectId,
				source: { name: project.name ?? project.slug, slug: project.slug },
				mode: row.mode,
				options: input.options,
				sections: row.sections,
				readme: input.readme,
			},
			BACKUP_MODULES,
		);
		await putArchive(key, bytes);
		await finishBackup(row.id, {
			status: "succeeded",
			sizeBytes: bytes.length,
			formatVersions: manifest.sections,
			release: manifest.release,
			destinationKey: key,
		}).catch(async (error) => {
			await deleteArchive(key).catch(() => {});
			throw error;
		});
	} catch (error) {
		logger.error(`[backup] ${row.id} of ${row.projectId} failed: ${String(error)}`, "BACKUP");
		await finishBackup(row.id, { status: "failed", error: reason(error) }).catch((e) =>
			logger.error(`[backup] could not record the failure of ${row.id}: ${String(e)}`, "BACKUP"),
		);
	}
}
