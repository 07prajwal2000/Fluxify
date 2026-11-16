import type { ObjectStorageAdapter } from "@fluxify/sdk/integrations";
import { describeStorageError, openObjectStorage } from "../objectStorage";
import { ARCHIVE_EXT, BACKUP_NAME, backupBase, META_EXT } from "./prefix";
import type { BackupDestination, BackupRow, FinishedArchive } from "./run";

/**
 * Backups to an Object Storage integration (#1106). Each run writes two objects
 * under the project's prefix: the archive, then its `.meta.json`. The summary
 * goes second, so a listing that finds an archive without one knows it is
 * incomplete. There is no shared index file: the listing is the history.
 */

export const META_KIND = "fluxify.project.backup-meta";

/**
 * What `.meta.json` holds: what a restore picker (#1107) lists after a
 * reconnect, before downloading anything. Unencrypted, so never a secret and
 * never the README's text.
 */
export function backupMeta(row: BackupRow, archive: FinishedArchive, name: string) {
	const { manifest } = archive;
	return {
		kind: META_KIND,
		backupId: row.id,
		archive: name,
		createdAt: manifest.createdAt,
		mode: manifest.mode,
		format: manifest.format,
		release: manifest.release,
		sizeBytes: archive.bytes.length,
		source: { projectId: row.projectId, ...manifest.source },
		sections: manifest.sections,
		hasReadme: archive.hasReadme,
	};
}

/** everything this feature wrote directly under `<prefix>/`, by backup (`<stamp>-<id>`) */
async function listBackups(storage: ObjectStorageAdapter, prefix: string) {
	// the trailing `/` keeps prefix `a` from reaching `ab/…`
	const dir = `${prefix}/`;
	const found = new Map<string, { archive: boolean; meta: boolean }>();
	let cursor: string | undefined;
	do {
		const page = await storage.list(dir, { cursor });
		for (const { key } of page.objects) {
			const match = BACKUP_NAME.exec(key.slice(dir.length));
			if (!key.startsWith(dir) || !match) continue;
			const entry = found.get(match[1]!) ?? { archive: false, meta: false };
			if (match[2] === "tar.gz") entry.archive = true;
			else entry.meta = true;
			found.set(match[1]!, entry);
		}
		cursor = page.cursor;
	} while (cursor);
	return found;
}

/**
 * Keeps the newest `keep` complete backups under the prefix and deletes every
 * backup older than the oldest one kept, archive and `.meta.json` together
 * (the summary first, so a half-deleted pair reads as incomplete). Names sort
 * by time because they start with the timestamp. Returns the keys deleted.
 */
export async function pruneBackups(storage: ObjectStorageAdapter, prefix: string, keep: number) {
	const found = await listBackups(storage, prefix);
	const names = [...found.keys()].sort();
	const complete = names.filter((n) => found.get(n)!.archive && found.get(n)!.meta);
	if (complete.length <= keep) return [];
	const oldestKept = complete[complete.length - keep]!;
	const deleted: string[] = [];
	for (const name of names.filter((n) => n < oldestKept)) {
		for (const ext of [META_EXT, ARCHIVE_EXT]) {
			const key = `${prefix}/${name}${ext}`;
			await storage.delete(key);
			deleted.push(key);
		}
	}
	return deleted;
}

export type StorageTarget = { integrationId: string; prefix: string; retention: number };

/** where one object storage run goes; opened lazily so a bad integration fails the run, not the caller */
export function storageDestination(row: BackupRow, target: StorageTarget): BackupDestination {
	const base = backupBase(target.prefix, row.createdAt, row.id);
	const metaKey = base + META_EXT;
	let storage: ObjectStorageAdapter | undefined;
	return {
		async save(archive) {
			const open = await openObjectStorage(row.projectId, target.integrationId);
			storage = open;
			const key = base + ARCHIVE_EXT;
			const meta = backupMeta(row, archive, key.slice(target.prefix.length + 1));
			// a failed put leaves nothing: a single PUT is atomic, a multipart one is aborted
			await open.put(key, archive.bytes, { contentType: "application/gzip" });
			try {
				await open.put(metaKey, new TextEncoder().encode(JSON.stringify(meta, null, 2)), {
					contentType: "application/json",
				});
			} catch (error) {
				await open.delete(key).catch(() => {});
				throw error;
			}
			return key;
		},
		async discard(key) {
			await storage?.delete(metaKey);
			await storage?.delete(key);
		},
		explain: (error) => describeStorageError(target.integrationId, error),
		async after() {
			if (storage) await pruneBackups(storage, target.prefix, target.retention);
		},
	};
}
