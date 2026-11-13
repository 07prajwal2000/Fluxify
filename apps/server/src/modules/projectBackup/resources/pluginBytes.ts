import type { PluginLiveVersion } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { fetchPluginFiles, fetchPluginTarball } from "../../plugins/install/source";
import { hashFiles, sha256Integrity, verifyIntegrity } from "../../plugins/sources/integrity";
import { MAX_TARBALL_BYTES } from "../../plugins/sources/limits";
import { archiveLocation, objectKeyOf } from "../../plugins/sources/location";
import { untar } from "../../plugins/sources/tar";
import { validatePlugin } from "../../plugins/sources/validate";

/**
 * A plugin version's bytes in a backup (#1101), one `.tgz` per version under
 * `files/plugins/<name>/<version>.tgz`, whatever its source: a restore never
 * needs the network, the plugins folder or the registry.
 */

export type StoredVersion = Pick<
	PluginLiveVersion,
	"version" | "source" | "location" | "integrity"
>;

export const tarballPath = (name: string, version: string) => `${name}/${version}.tgz`;

/** export: the tarball as approved; a folder is checked against its hash, then packed under `package/` */
export async function tarballOf(v: StoredVersion): Promise<Uint8Array> {
	if (v.source !== "fs") return fetchPluginTarball({ ...v, source: v.source });
	const files = await fetchPluginFiles(v);
	const entries = Object.fromEntries([...files].map(([path, bytes]) => [`package/${path}`, bytes]));
	return new Bun.Archive(entries, { compress: "gzip" }).bytes();
}

/** the integrity the version was approved with, checked the way its source checks it */
async function matches({ source, integrity }: StoredVersion, bytes: Uint8Array) {
	if (source === "fs") return hashFiles(await untar(bytes)) === integrity;
	if (source !== "npm") return sha256Integrity(bytes) === integrity;
	try {
		verifyIntegrity(bytes, integrity);
		return true;
	} catch {
		return false;
	}
}

/**
 * import: the archive's bytes for one version, refused unless they are exactly
 * what was approved and pass the checks every source passes. Nothing is written
 * here. Returns the manifest read from the bytes, which is what loads.
 */
export async function checkedTarball(
	name: string,
	v: StoredVersion,
	bytes: Uint8Array | undefined,
) {
	const which = `Plugin "${name}" ${v.version}`;
	if (!bytes) throw new BadRequestError(`${which}: its files aren't in this backup.`);
	if (bytes.length > MAX_TARBALL_BYTES || !(await matches(v, bytes).catch(() => false)))
		throw new BadRequestError(
			`${which} doesn't match the integrity it was approved with. The backup was altered or damaged; nothing was restored.`,
		);
	const valid = validatePlugin(await untar(bytes));
	if (valid.manifest.name !== name || valid.version !== v.version)
		throw new BadRequestError(`${which}: its files hold ${valid.manifest.name} ${valid.version}.`);
	return valid.manifest;
}

/**
 * Where the restored version lives: always the Object Store, as an upload is.
 * A `url` plugin keeps its source and the address it came from; an `npm` or
 * folder plugin becomes an `upload`, so it loads with no registry and no
 * mounted folder. The integrity is then the tarball's own sha256.
 */
export function restoredSource(v: StoredVersion, key: string, bytes: Uint8Array) {
	const integrity = sha256Integrity(bytes);
	if (v.source === "url") {
		const url = v.location.slice(objectKeyOf(v.location).length + 1);
		return { source: "url" as const, location: archiveLocation(key, url || undefined), integrity };
	}
	return { source: "upload" as const, location: key, integrity };
}
