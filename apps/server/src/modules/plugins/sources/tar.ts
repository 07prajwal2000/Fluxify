import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { BadRequestError } from "../../../errors/badRequestError";
import { MAX_ENTRIES, MAX_UNPACKED_BYTES } from "./limits";

/**
 * Unpacks a plugin tarball in memory. Nothing touches the disk and nothing runs,
 * so every rule here is about what the bytes say: the archive is untrusted until
 * it has passed. Files come back keyed by their path below the archive's single
 * top-level folder (`package/` for npm and `bun pm pack`).
 */
export type PluginFiles = Map<string, Uint8Array>;

const BLOCK = 512;
const text = new TextDecoder("utf-8", { fatal: true });

const gunzipAsync = promisify(gunzip);

/** gunzip, refusing to inflate past `max` so a bomb never reaches memory */
async function inflate(bytes: Uint8Array, max: number): Promise<Uint8Array> {
	try {
		return await gunzipAsync(bytes, { maxOutputLength: max });
	} catch (error) {
		if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
			throw new BadRequestError(
				`The plugin unpacks to more than ${max / 1024 / 1024} MB; that is the limit`,
			);
		throw new BadRequestError("The file is not a valid .tgz archive");
	}
}

const cString = (block: Uint8Array, from: number, to: number) => {
	const end = block.indexOf(0, from);
	return text.decode(block.subarray(from, end === -1 || end > to ? to : end));
};

function octal(block: Uint8Array, from: number, to: number) {
	// base-256 sizes (high bit set) are for files past 8 GB, far over the cap
	if (block[from]! & 0x80) throw new BadRequestError("The archive holds a file that is too large");
	const value = Number.parseInt(cString(block, from, to).trim() || "0", 8);
	if (!Number.isInteger(value) || value < 0) throw new BadRequestError("The archive is corrupt");
	return value;
}

/** `len key=value\n` records of a pax header */
function paxRecords(data: Uint8Array) {
	const records = new Map<string, string>();
	let at = 0;
	while (at < data.length) {
		const space = data.indexOf(0x20, at);
		const length = Number.parseInt(text.decode(data.subarray(at, space)), 10);
		if (space === -1 || !(length > 0)) throw new BadRequestError("The archive is corrupt");
		const record = text.decode(data.subarray(space + 1, at + length - 1));
		const eq = record.indexOf("=");
		records.set(record.slice(0, eq), record.slice(eq + 1));
		at += length;
	}
	return records;
}

/** A safe relative path, or a rejection. `..`, absolute and drive paths never get in. */
function cleanPath(raw: string) {
	if (
		!raw ||
		raw.includes("\0") ||
		raw.includes("\\") ||
		raw.startsWith("/") ||
		/^[a-z]:/i.test(raw)
	)
		throw new BadRequestError(`The archive holds an unsafe path '${raw}'`);
	const parts = raw.split("/").filter((p) => p && p !== ".");
	if (parts.includes("..")) throw new BadRequestError(`The archive holds an unsafe path '${raw}'`);
	return parts;
}

const REJECTED: Record<string, string> = {
	"1": "a hard link",
	"2": "a symbolic link",
	"3": "a device file",
	"4": "a device file",
	"6": "a named pipe",
};

/** Reads a `.tgz` into its files, or throws a `BadRequestError` naming the first rule it breaks. */
export async function untar(tgz: Uint8Array): Promise<PluginFiles> {
	const tar = await inflate(tgz, MAX_UNPACKED_BYTES);
	const files: PluginFiles = new Map();
	let top: string | undefined;
	let entries = 0;
	let longName: string | undefined;
	let pax: Map<string, string> | undefined;

	for (let at = 0; at + BLOCK <= tar.length; ) {
		const header = tar.subarray(at, at + BLOCK);
		if (header.every((b) => b === 0)) break;
		const type = String.fromCharCode(header[156] || 0x30);
		const size = octal(header, 124, 136);
		const start = at + BLOCK;
		if (start + size > tar.length) throw new BadRequestError("The archive is truncated");
		const data = tar.subarray(start, start + size);
		at = start + Math.ceil(size / BLOCK) * BLOCK;

		if (type === "g") continue;
		if (type === "x") pax = paxRecords(data);
		else if (type === "L") longName = cString(data, 0, data.length);
		else if (REJECTED[type])
			throw new BadRequestError(
				`The archive holds ${REJECTED[type]} ('${cString(header, 0, 100)}'); plugins ship plain files only`,
			);
		else if (type !== "0" && type !== "5")
			throw new BadRequestError(`The archive holds an unsupported entry type '${type}'`);
		if (type === "x" || type === "L") continue;

		const prefix = cString(header, 345, 500);
		const name =
			pax?.get("path") ?? longName ?? (prefix ? `${prefix}/` : "") + cString(header, 0, 100);
		pax = longName = undefined;
		if (++entries > MAX_ENTRIES)
			throw new BadRequestError(`The plugin has more than ${MAX_ENTRIES} files; that is the limit`);

		const [folder, ...rest] = cleanPath(name);
		if (top !== undefined && folder !== top)
			throw new BadRequestError("The archive must hold a single top-level folder (package/)");
		top = folder;
		if (type === "5") continue;
		if (!rest.length)
			throw new BadRequestError("The archive must hold a single top-level folder (package/)");
		const path = rest.join("/");
		if (files.has(path)) throw new BadRequestError(`The archive holds '${path}' twice`);
		files.set(path, data.slice());
	}
	return files;
}
