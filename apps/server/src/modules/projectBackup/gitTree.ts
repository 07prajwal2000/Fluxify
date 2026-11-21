import { EncryptionService } from "../../lib/encryption";
import { checkIntegrity, type Payload, parseManifest, readmeOf } from "./archive";
import type { BackupManifest } from "./manifest";
import type { ArchiveSource } from "./restore";
import type { RestoreWarning } from "./types";

/**
 * A backup as the files of a folder in a git repository (#1150), and back.
 * The same entries as the archive (`archive.ts`), exploded so each resource
 * diffs on its own:
 *
 *   manifest.json, README.md, sections/<name>.json, files/<name>/<path>
 *
 * Sections are written indented, so a diff shows what changed; the archive's
 * integrity hash is over the compact form, which reading them back restores
 * exactly. With `encryptSecrets`, the sections holding credentials and app
 * config values are sealed with MASTER_ENCRYPTION_KEY as `.json.enc`.
 */

export const SEALED_SECTIONS = ["appConfig", "integrations"];
const SEALED = /^sections\/([^/]+)\.json\.enc$/;
const PLAIN = /^sections\/[^/]+\.json$/;

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** a file of the backup's folder; `seal` holds the plaintext of a file to seal */
export type TreeFile = { bytes: Uint8Array } | { seal: Uint8Array };

const reformat = (bytes: Uint8Array, indent?: number) => {
	try {
		return encode(JSON.stringify(JSON.parse(decode(bytes)), null, indent));
	} catch {
		// left as it is: the integrity check refuses it
		return bytes;
	}
};

export function backupFiles(
	archive: { manifest: BackupManifest; payload: Payload; readme?: string },
	encryptSecrets: boolean,
) {
	const files = new Map<string, TreeFile>([
		["manifest.json", { bytes: encode(JSON.stringify(archive.manifest, null, 2)) }],
	]);
	// the same test and bytes as `writeArchive`, which hashed them
	if (archive.readme?.trim()) files.set("README.md", { bytes: encode(archive.readme) });
	for (const [path, bytes] of archive.payload) {
		const sealed = encryptSecrets && SEALED_SECTIONS.some((n) => path === `sections/${n}.json`);
		if (sealed) files.set(`${path}.enc`, { seal: bytes });
		else files.set(path, { bytes: PLAIN.test(path) ? reformat(bytes, 2) : bytes });
	}
	return files;
}

const skipped = (section: string): RestoreWarning => ({
	section,
	message:
		"This section is encrypted with a different MASTER_ENCRYPTION_KEY, so it is left out: the restored project has none of it. Add it again by hand.",
});

/**
 * A backup folder's files (paths relative to it) as an opened archive. A
 * sealed section this instance can't decrypt is skipped with a warning, and
 * then the integrity check is too, since the payload is no longer whole.
 */
export function openTree(files: Map<string, Uint8Array>): ArchiveSource {
	const manifest = parseManifest(files.get("manifest.json"));
	const note = readmeOf(files);
	const payload: Payload = new Map();
	const warnings: RestoreWarning[] = [];
	for (const [path, bytes] of files) {
		const sealed = SEALED.exec(path);
		if (path.startsWith("files/")) payload.set(path, bytes);
		else if (PLAIN.test(path)) payload.set(path, reformat(bytes));
		else if (sealed)
			try {
				payload.set(path.slice(0, -4), EncryptionService.decryptBytes(bytes));
			} catch {
				delete manifest.sections[sealed[1]!];
				warnings.push(skipped(sealed[1]!));
			}
	}
	if (!warnings.length) checkIntegrity(manifest, payload, note);
	return { manifest, payload, readme: note ? decode(note) : null, warnings };
}
