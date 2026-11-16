import { logger } from "@fluxify/common";
import { backupObjects } from "../../db/natsObjects";
import { expiredArchives, failStaleRuns, forgetArchive } from "./history";

/**
 * Where a manual backup waits to be downloaded (#1103): a bucket in the NATS
 * Object Store, which every admin replica reads, so the download works whichever
 * replica the run happened on. Nothing is written to the admin's disk.
 */

/** How long a manual archive can be downloaded. A constant, not an env var, like the agent conversation retention (#721). */
export const ARCHIVE_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

export const archiveKey = (projectId: string, id: string) => `manual/${projectId}/${id}.tar.gz`;

export async function putArchive(key: string, bytes: Uint8Array) {
	try {
		await (await backupObjects()).put(key, bytes);
	} catch (error) {
		// a failed upload can leave chunks behind; a failed run leaves no file
		await deleteArchive(key).catch(() => {});
		throw error;
	}
}

/** the object store hands back a plain (non-shared) buffer; the cast lets it be a `Response` body */
export const getArchive = async (key: string) =>
	(await (await backupObjects()).get(key)) as Uint8Array<ArrayBuffer> | null;
export const deleteArchive = async (key: string) => (await backupObjects()).delete(key);

/** when a finished archive stops being downloadable */
export const expiresAt = (finishedAt: Date) =>
	new Date(finishedAt.getTime() + ARCHIVE_RETENTION_DAYS * DAY_MS);

/**
 * Daily: drops archives past the retention (the row stays as history, with no
 * file) and fails runs whose process died. Idempotent, so a missed tick is
 * covered by the next one. One archive failing to delete never stops the rest.
 */
export async function expireBackups(now = new Date()) {
	const cutoff = new Date(now.getTime() - ARCHIVE_RETENTION_DAYS * DAY_MS);
	let expired = 0;
	for (const { id, key } of await expiredArchives(cutoff)) {
		try {
			if (key) await deleteArchive(key);
			await forgetArchive(id);
			expired++;
		} catch (error) {
			logger.error(`[backup] could not delete the archive of ${id}: ${String(error)}`, "BACKUP");
		}
	}
	const stale = await failStaleRuns(now);
	if (expired || stale.length)
		logger.info(
			`[backup] expired ${expired} archive(s), failed ${stale.length} interrupted run(s)`,
			"BACKUP",
		);
	return { expired, interrupted: stale.length };
}
