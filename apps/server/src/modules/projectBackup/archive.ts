import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { z } from "zod";
import { BadRequestError } from "../../errors/badRequestError";
import { EncryptionService } from "../../lib/encryption";
import { hashFiles } from "../plugins/sources/integrity";
import { BACKUP_FORMAT, BACKUP_KIND, type BackupManifest, manifestSchema } from "./manifest";

/**
 * The archive is a `.tar.gz` holding `manifest.json` and the payload:
 * `sections/<name>.json` and `files/<name>/<path>`. In a template the payload
 * sits in the archive as is; in a backup it is a gzipped tar of the same files,
 * sealed with MASTER_ENCRYPTION_KEY as `payload.enc`. Either way the manifest
 * stays readable and its `integrity` is the hash of the plain payload.
 *
 * Tar is Bun's own `Bun.Archive`: the plugin installer's `untar` insists on a
 * single `package/` folder and plugin-sized limits, and nothing else here
 * writes tarballs.
 */
export type Payload = Map<string, Uint8Array>;

const MANIFEST = "manifest.json";
const SEALED = "payload.enc";
/** The author's note, at the archive root and never sealed, so it can be read before a restore. */
const README = "README.md";
export const MAX_README_BYTES = 64 * 1024;

/** ponytail: one cap on everything unpacked (the zip-bomb guard); archives sit in memory, stream them if projects outgrow it */
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

const gunzipAsync = promisify(gunzip);
const NOT_A_BACKUP = "That isn't a Fluxify project backup.";

/** gunzip under the cap, then read the tar; nothing touches the disk */
async function unpack(tgz: Uint8Array): Promise<Payload> {
	let tar: Uint8Array;
	try {
		tar = await gunzipAsync(tgz, { maxOutputLength: MAX_UNPACKED_BYTES });
	} catch (error) {
		if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
			throw new BadRequestError(
				`This backup unpacks to more than ${MAX_UNPACKED_BYTES / 1024 / 1024} MB; that is the limit.`,
			);
		throw new BadRequestError(`${NOT_A_BACKUP} It is not a .tar.gz archive.`);
	}
	try {
		const entries: Payload = new Map();
		for (const [path, file] of await new Bun.Archive(tar).files())
			entries.set(path, await file.bytes());
		return entries;
	} catch {
		throw new BadRequestError(`${NOT_A_BACKUP} The archive is corrupt.`);
	}
}

const pack = (files: Payload | Record<string, Uint8Array>) =>
	new Bun.Archive(files instanceof Map ? Object.fromEntries(files) : files, {
		compress: "gzip",
	}).bytes();

export type ManifestHead = Omit<BackupManifest, "kind" | "format" | "integrity">;

/** what the integrity hash covers: the payload and, when there is one, the README */
const hashed = (payload: Payload, readme?: Uint8Array): Payload =>
	readme ? new Map([...payload, [README, readme]]) : payload;

export async function writeArchive(head: ManifestHead, payload: Payload, readme?: string) {
	const note = readme?.trim() ? new TextEncoder().encode(readme) : undefined;
	if (note && note.length > MAX_README_BYTES)
		throw new BadRequestError(`The README is longer than ${MAX_README_BYTES / 1024} KB.`);
	const manifest: BackupManifest = {
		kind: BACKUP_KIND,
		format: BACKUP_FORMAT,
		...head,
		integrity: hashFiles(hashed(payload, note)),
	};
	const entries: Record<string, Uint8Array> = {
		[MANIFEST]: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
	};
	if (note) entries[README] = note;
	if (manifest.mode === "backup")
		entries[SEALED] = EncryptionService.encryptBytes(await pack(payload));
	else Object.assign(entries, Object.fromEntries(payload));
	return { manifest, bytes: await pack(entries) };
}

function parseManifest(raw: Uint8Array | undefined): BackupManifest {
	let doc: { kind?: unknown; format?: unknown } | undefined;
	try {
		doc = raw && JSON.parse(new TextDecoder().decode(raw));
	} catch {}
	if (doc?.kind !== BACKUP_KIND) throw new BadRequestError(NOT_A_BACKUP);
	if (typeof doc.format === "number" && doc.format > BACKUP_FORMAT)
		throw new BadRequestError(
			"This backup was made by a newer version of Fluxify. Update Fluxify to restore it.",
		);
	const parsed = manifestSchema.safeParse(doc);
	if (!parsed.success)
		throw new BadRequestError(
			`This backup's manifest is invalid: ${z.prettifyError(parsed.error)}`,
		);
	return parsed.data;
}

/** the README of an unpacked archive; refused over the limit, since nothing has checked it yet */
function readmeOf(entries: Payload): Uint8Array | undefined {
	const note = entries.get(README);
	if (note && note.length > MAX_README_BYTES)
		throw new BadRequestError(
			`${NOT_A_BACKUP} Its README is longer than ${MAX_README_BYTES / 1024} KB.`,
		);
	return note;
}

/**
 * The manifest and the author's README (null when there is none), without
 * decrypting: what the UI shows before a restore. The README is not checked
 * against the hash here; `openArchive` does that before anything is imported.
 */
export async function readManifest(tgz: Uint8Array) {
	const entries = await unpack(tgz);
	const note = readmeOf(entries);
	return {
		...parseManifest(entries.get(MANIFEST)),
		readme: note ? new TextDecoder().decode(note) : null,
	};
}

async function unseal(sealed: Uint8Array | undefined) {
	if (!sealed)
		throw new BadRequestError("This backup is damaged: its encrypted contents are missing.");
	let inner: Uint8Array;
	try {
		inner = EncryptionService.decryptBytes(sealed);
	} catch {
		throw new BadRequestError(
			"This backup can't be decrypted. It was made on an instance with a different MASTER_ENCRYPTION_KEY, or it is damaged. Restore it on an instance with the key it was made with.",
		);
	}
	return unpack(inner);
}

/** The manifest and the plain payload, decrypted and checked against the manifest's hash (which covers the README too). */
export async function openArchive(tgz: Uint8Array) {
	const entries = await unpack(tgz);
	const manifest = parseManifest(entries.get(MANIFEST));
	const note = readmeOf(entries);
	entries.delete(MANIFEST);
	entries.delete(README);
	const payload = manifest.mode === "backup" ? await unseal(entries.get(SEALED)) : entries;
	if (hashFiles(hashed(payload, note)) !== manifest.integrity)
		throw new BadRequestError(
			"This backup is damaged or was altered: its contents don't match its manifest.",
		);
	return { manifest, payload, readme: note ? new TextDecoder().decode(note) : null };
}
