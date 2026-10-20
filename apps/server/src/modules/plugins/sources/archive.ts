import { pluginObjects } from "../../../db/natsObjects";
import { BadRequestError } from "../../../errors/badRequestError";
import { audit } from "../../audit";
import { assertCreator, type Caller, type PluginVersion, registerPluginVersion } from "../service";
import { sha256Integrity } from "./integrity";
import { MAX_TARBALL_BYTES } from "./limits";
import { archiveLocation, pluginObjectKey } from "./location";
import { untar } from "./tar";
import { validatePlugin } from "./validate";

/** the registry call every source ends in, plus the audit event for what it added */
export async function registerSourced(projectId: string, version: PluginVersion) {
	const result = await registerPluginVersion(projectId, version);
	if (result.changed)
		await audit.record({
			projectId,
			resourceType: "plugin",
			resourceId: result.plugin.id,
			action: "create",
			changedFields: ["version", "integrity"],
			message: `${result.plugin.name}@${result.plugin.version} added from ${version.source}`,
		});
	return result.plugin;
}

/**
 * A tarball into the registry (an upload, or a trusted URL once a creator has
 * approved the fetch): unpacked and checked in memory, stored in the Object
 * Store under its name and version, then registered, which leaves it pending.
 *
 * ponytail: when registering fails after the store, the object stays; the
 * scanner (P5) clears objects no plugin row points at.
 */
export async function registerArchive(
	projectId: string,
	tgz: Uint8Array,
	source: "upload" | "url",
	options: { url?: string; expectedName?: string } = {},
) {
	if (tgz.length > MAX_TARBALL_BYTES)
		throw new BadRequestError(
			`The file is larger than ${MAX_TARBALL_BYTES / 1024 / 1024} MB; that is the limit`,
		);
	const { manifest, version } = validatePlugin(await untar(tgz));
	const key = pluginObjectKey(projectId, manifest.name, version);
	await (await pluginObjects()).put(key, tgz);
	return registerSourced(projectId, {
		manifest,
		version,
		source,
		location: archiveLocation(key, options.url),
		integrity: sha256Integrity(tgz),
		expectedName: options.expectedName,
	});
}

/** a creator uploads a `.tgz` built by `fluxify-cli blocks build` */
export async function uploadPlugin(projectId: string, tgz: Uint8Array, caller: Caller) {
	assertCreator(caller, projectId);
	return registerArchive(projectId, tgz, "upload");
}
