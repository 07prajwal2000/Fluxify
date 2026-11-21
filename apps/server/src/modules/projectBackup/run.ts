import { logger } from "@fluxify/common";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { type projectBackupsEntity, projectsEntity } from "../../db/schema";
import { CustomError } from "../../errors/customError";
import type { Payload } from "./archive";
import { archiveKey, deleteArchive, putArchive } from "./archives";
import { createBackup } from "./backup";
import { finishBackup } from "./history";
import type { BackupManifest } from "./manifest";
import { BACKUP_MODULES } from "./modules";
import type { BackupOptions } from "./types";

export type BackupRow = typeof projectBackupsEntity.$inferSelect;

/** what a finished archive is, for the place that keeps it */
export type FinishedArchive = {
	bytes: Uint8Array;
	manifest: BackupManifest;
	hasReadme: boolean;
	/** the plain entries and the README, for a destination that stores them exploded (git, #1150) */
	payload: Payload;
	readme?: string;
};

/** Where a run puts its archive: the Object Store for a manual one (#1103), a bucket for #1106, a git repository for #1150. */
export type BackupDestination = {
	/** stores a finished archive and returns its key; leaves nothing behind when it throws */
	save(archive: FinishedArchive): Promise<string>;
	/** removes what `save` stored, when the row can't be updated */
	discard(key: string): Promise<void>;
	/** a message for the history, for a failure this destination understands */
	explain?(error: unknown): string | undefined;
	/** runs once the row says succeeded (retention); a failure is logged, never fails the backup */
	after?(): Promise<void>;
};

/** the manual destination: the NATS Object Store, downloadable for a few days */
const objectStore = (row: BackupRow): BackupDestination => ({
	async save({ bytes }) {
		const key = archiveKey(row.projectId, row.id);
		await putArchive(key, bytes);
		return key;
	},
	discard: deleteArchive,
});

/** what the history shows when a run fails: our own errors say what to do, anything else is generic */
const reason = (error: unknown, destination: BackupDestination) =>
	error instanceof CustomError
		? error.message
		: (destination.explain?.(error) ??
			"The backup failed unexpectedly. Check the server log, then try again.");

/**
 * One backup, start to finish, on this admin process (it holds the database
 * connection; workers never do). Never throws: the outcome lands on the row.
 * The archive is stored only once it is complete, and removed again if the row
 * can't be updated, so a failed run leaves no file.
 */
export async function runBackup(
	row: BackupRow,
	input: { options: BackupOptions; readme?: string },
	destination: BackupDestination = objectStore(row),
) {
	try {
		const [project] = await db
			.select({ name: projectsEntity.name, slug: projectsEntity.slug })
			.from(projectsEntity)
			.where(eq(projectsEntity.id, row.projectId));
		if (!project) throw new Error("the project is gone");
		const { bytes, manifest, payload } = await createBackup(
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
		const key = await destination.save({
			bytes,
			manifest,
			hasReadme: Boolean(input.readme),
			payload,
			readme: input.readme,
		});
		await finishBackup(row.id, {
			status: "succeeded",
			sizeBytes: bytes.length,
			formatVersions: manifest.sections,
			release: manifest.release,
			destinationKey: key,
		}).catch(async (error) => {
			await destination.discard(key).catch(() => {});
			throw error;
		});
	} catch (error) {
		logger.error(`[backup] ${row.id} of ${row.projectId} failed: ${String(error)}`, "BACKUP");
		await finishBackup(row.id, { status: "failed", error: reason(error, destination) }).catch((e) =>
			logger.error(`[backup] could not record the failure of ${row.id}: ${String(e)}`, "BACKUP"),
		);
		return;
	}
	await destination
		.after?.()
		.catch((error) =>
			logger.error(`[backup] after ${row.id} of ${row.projectId}: ${String(error)}`, "BACKUP"),
		);
}
