import { type ObjectBucket, openObjectBucket } from "@fluxify/common/nats";
import { initializeNats } from "./nats";

/**
 * Files live in a NATS Object Store, not in KV: a KV value is capped by the
 * server's `max_payload`, an object is chunked. Today that is plugin tarballs
 * (uploaded or fetched from a trusted URL), which workers download.
 *
 * One bucket for every environment: the tarball is the same bytes whatever
 * runs it. Which environment may load a plugin is decided by its artifact in
 * the per-environment KV bucket, not by where the file sits.
 */
export const PLUGIN_BUCKET = "fluxify_plugins";

let bucket: Promise<ObjectBucket> | undefined;

export function pluginObjects(): Promise<ObjectBucket> {
	bucket ??= initializeNats()
		.then((nc) => openObjectBucket(nc, PLUGIN_BUCKET))
		.catch((error) => {
			bucket = undefined;
			throw error;
		});
	return bucket;
}

/**
 * Manual project backups (#1103) wait here until they are downloaded or
 * expire (`modules/projectBackup/archives.ts`). Separate from the plugin
 * bucket so a purge of one can never touch the other.
 */
export const BACKUP_BUCKET = "fluxify_backups";

let backups: Promise<ObjectBucket> | undefined;

export function backupObjects(): Promise<ObjectBucket> {
	backups ??= initializeNats()
		.then((nc) => openObjectBucket(nc, BACKUP_BUCKET))
		.catch((error) => {
			backups = undefined;
			throw error;
		});
	return backups;
}
