import { join } from "node:path";
import { pluginObjects } from "../../../db/natsObjects";
import type { PluginArtifact } from "../../compiler/artifacts";
import { registryUrl } from "../../packages/registryUrl";
import { readCapped } from "../sources/download";
import { hashFiles, sha256Integrity, verifyIntegrity } from "../sources/integrity";
import { FETCH_TIMEOUT_MS } from "../sources/limits";
import { objectKeyOf } from "../sources/location";
import { type PluginFiles, untar } from "../sources/tar";
import { pluginsRoot, readTree } from "../sources/tree";

/**
 * The files of an approved plugin, read from where its source keeps them and
 * checked against the integrity the approval was bound to (#859). Nothing
 * comes back unless the hash matches, so what a worker installs is what a
 * creator approved. The archive is unpacked by the same in-memory function
 * the admin validated it with; nothing touches the disk here.
 */
type Source = Pick<PluginArtifact, "source" | "location" | "integrity">;

export async function fetchPluginFiles(artifact: Source): Promise<PluginFiles> {
	switch (artifact.source) {
		case "upload":
		case "url":
			return untar(await fromObjectStore(artifact));
		case "npm":
			return untar(await fromRegistry(artifact));
		case "fs":
			return fromDirectory(artifact);
	}
}

async function fromObjectStore({ location, integrity }: Source) {
	const key = objectKeyOf(location);
	const bytes = await (await pluginObjects()).get(key);
	if (!bytes) throw new Error(`the plugin's tarball '${key}' is not in the object store`);
	if (sha256Integrity(bytes) !== integrity)
		throw new Error(
			`the stored tarball '${key}' does not match the approved integrity; refusing it`,
		);
	return bytes;
}

async function fromRegistry({ location, integrity }: Source) {
	const at = location.lastIndexOf("@");
	const name = location.slice(0, at);
	const version = location.slice(at + 1);
	const signal = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);
	const packument = await fetch(`${registryUrl()}/${name.replace("/", "%2f")}`, {
		signal: signal(),
	});
	if (!packument.ok) throw new Error(`the registry answered ${packument.status} for ${name}`);
	const tarball = ((await packument.json()) as Packument).versions?.[version]?.dist?.tarball;
	if (!tarball) throw new Error(`${location} is no longer on the registry`);
	const res = await fetch(tarball, { signal: signal() });
	if (!res.ok)
		throw new Error(`the registry answered ${res.status} for the tarball of ${location}`);
	const bytes = await readCapped(res);
	verifyIntegrity(bytes, integrity);
	return bytes;
}

type Packument = { versions?: Record<string, { dist?: { tarball?: string } }> };

/** the directory can change after approval, so it is hashed again and what is hashed is what is used */
async function fromDirectory({ location, integrity }: Source) {
	const root = pluginsRoot();
	if (!root) throw new Error("FLUXIFY_PLUGINS_DIR is not set on this worker");
	// a single directory name: nothing that walks out of the plugins directory
	if (!location || location.startsWith(".") || /[/\\]/.test(location))
		throw new Error(`'${location}' is not a plugin directory`);
	const files = await readTree(join(root, location));
	if (hashFiles(files) !== integrity)
		throw new Error(
			`the directory '${location}' changed since it was approved (hash mismatch); approve it again`,
		);
	return files;
}
