import type { ObjectStorageAdapter } from "@fluxify/sdk/integrations";
import type { z } from "zod";
import { BadRequestError } from "../../errors/badRequestError";
import { NotFoundError } from "../../errors/notFoundError";
import { describeStorageError, openObjectStorage } from "../objectStorage";
import { MAX_UNPACKED_BYTES } from "./archive";
import { ARCHIVE_EXT, BACKUP_NAME, backupMetaSchema, backupPrefixSchema, META_EXT } from "./prefix";
import { bucketBackups } from "./storageDestination";

/**
 * Backups in an Object Storage bucket, read back (#1107). The bucket listing is
 * the history: each complete pair under a prefix is one backup, described by
 * its `.meta.json` alone, so this works on a fresh instance with no Postgres
 * rows. Anything in the bucket may have been written by someone else, so a
 * summary that doesn't parse is skipped, never trusted.
 */

/**
 * The largest archive a restore downloads. The engine refuses one that
 * unpacks past `MAX_UNPACKED_BYTES`, and a gzip archive is never meaningfully
 * larger than what it unpacks to, so anything bigger would fail anyway, after
 * being held in memory. The upload cap (100 MB) is Bun's request ceiling and
 * does not apply to a download.
 */
export const MAX_REMOTE_ARCHIVE_BYTES = MAX_UNPACKED_BYTES;

/** where a scan for prefixes stops; a bucket used only for backups never gets near it */
const MAX_SCANNED_KEYS = 20_000;
const META_READS_AT_ONCE = 16;

/** a storage failure as the user has to fix it; our own refusals pass through */
async function explained<T>(integrationId: string, work: () => Promise<T>) {
	try {
		return await work();
	} catch (error) {
		if (error instanceof BadRequestError || error instanceof NotFoundError) throw error;
		const message = describeStorageError(integrationId, error);
		throw message ? new BadRequestError(message) : error;
	}
}

async function readMeta(storage: ObjectStorageAdapter, key: string) {
	try {
		const stream = await storage.get(key);
		if (!stream) return null;
		const parsed = backupMetaSchema.safeParse(JSON.parse(await new Response(stream).text()));
		return parsed.success ? parsed.data : null;
	} catch (error) {
		// unreadable JSON is skipped; a failed read is the bucket's problem and is reported
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

/** a backup as listed; `sizeBytes` is what the bucket holds, not what the summary claims */
export type RemoteBackup = z.infer<typeof backupMetaSchema> & { key: string };

/** complete backups directly under `<prefix>/`, newest first, from their `.meta.json` only */
export async function listRemoteBackups(projectId: string, integrationId: string, prefix: string) {
	const storage = await openObjectStorage(projectId, integrationId);
	return explained(integrationId, async () => {
		const found = await bucketBackups(storage, prefix);
		// names start with the time, so text order is time order
		const names = [...found.keys()]
			.filter((n) => found.get(n)!.archive && found.get(n)!.meta)
			.sort()
			.reverse();
		const out: RemoteBackup[] = [];
		for (let i = 0; i < names.length; i += META_READS_AT_ONCE) {
			const batch = names.slice(i, i + META_READS_AT_ONCE);
			const metas = await Promise.all(
				batch.map((n) => readMeta(storage, `${prefix}/${n}${META_EXT}`)),
			);
			metas.forEach((meta, j) => {
				const name = batch[j]!;
				if (meta)
					out.push({
						...meta,
						key: `${prefix}/${name}${ARCHIVE_EXT}`,
						sizeBytes: found.get(name)!.size,
					});
			});
		}
		return out;
	});
}

/**
 * Every prefix in the bucket that directly holds a backup summary, so a fresh
 * project can find the source's folder, whose name is the source's slug.
 * ponytail: scans the whole bucket up to `MAX_SCANNED_KEYS`; a delimiter
 * listing would be cheaper once the adapter offers one.
 */
export async function listBackupPrefixes(projectId: string, integrationId: string) {
	const storage = await openObjectStorage(projectId, integrationId);
	return explained(integrationId, async () => {
		const prefixes = new Set<string>();
		let cursor: string | undefined;
		let scanned = 0;
		do {
			const page = await storage.list("", { cursor });
			for (const { key } of page.objects) {
				const cut = key.lastIndexOf("/");
				const name = key.slice(cut + 1);
				const prefix = key.slice(0, cut);
				if (cut > 0 && name.endsWith(META_EXT) && BACKUP_NAME.test(name))
					if (backupPrefixSchema.safeParse(prefix).success) prefixes.add(prefix);
			}
			scanned += page.objects.length;
			cursor = page.cursor;
		} while (cursor && scanned < MAX_SCANNED_KEYS);
		return [...prefixes].sort();
	});
}

/** `<prefix>/<stamp>-<id>.tar.gz`, or a refusal: the key comes from the request */
function archiveKey(key: string) {
	const cut = key.lastIndexOf("/");
	const match = BACKUP_NAME.exec(key.slice(cut + 1));
	if (
		cut < 1 ||
		match?.[2] !== "tar.gz" ||
		!backupPrefixSchema.safeParse(key.slice(0, cut)).success
	)
		throw new BadRequestError(`"${key}" is not a backup archive in this bucket.`);
	return { key, meta: `${key.slice(0, cut)}/${match[1]}${META_EXT}` };
}

/**
 * One backup's archive, into memory, as the engine takes it. Checked before
 * the download: a complete pair, and no larger than `MAX_REMOTE_ARCHIVE_BYTES`.
 * #1130 (rollback in place) reuses it.
 */
export async function downloadRemoteArchive(projectId: string, integrationId: string, key: string) {
	const target = archiveKey(key);
	const storage = await openObjectStorage(projectId, integrationId);
	return explained(integrationId, async () => {
		const [head, meta] = await Promise.all([storage.head(target.key), storage.head(target.meta)]);
		if (!head) throw new NotFoundError(`There is no backup at "${key}".`);
		if (!meta)
			throw new BadRequestError(`The backup at "${key}" is incomplete: it has no ${META_EXT}.`);
		if (head.size > MAX_REMOTE_ARCHIVE_BYTES) {
			const mb = (n: number) => Math.ceil(n / 1024 / 1024);
			throw new BadRequestError(
				`This backup is ${mb(head.size)} MB; the largest that can be restored is ${mb(MAX_REMOTE_ARCHIVE_BYTES)} MB.`,
			);
		}
		const stream = await storage.get(target.key);
		if (!stream) throw new NotFoundError(`There is no backup at "${key}".`);
		return new Uint8Array(await new Response(stream).arrayBuffer());
	});
}
