import type { CanvasBlock, CanvasEdge } from "../types";

/**
 * Wire format for everything that leaves the canvas: copy/paste, and the
 * export/import file. Blocks travel in the *server* shape (`CanvasBlock` /
 * `CanvasEdge`), never as React Flow nodes — React Flow's node shape carries
 * transient UI fields and changes with the library, the server shape is the one
 * we actually own.
 */

/** Marks a payload as ours. A clipboard read that lacks it is someone else's text. */
export const TRANSFER_KIND = "fluxify.canvas";

/**
 * Bump whenever the payload shape changes, and add the matching entry to
 * `MIGRATIONS` so older exports keep importing.
 */
export const TRANSFER_VERSION = 1;

export const TRANSFER_FILE_EXTENSION = ".fluxcanvas";
export const TRANSFER_MIME = "application/vnd.fluxify.canvas+json";

export type CanvasTransferDoc = {
	kind: typeof TRANSFER_KIND;
	version: number;
	/** ISO timestamp, informational only. */
	exportedAt: string;
	blocks: CanvasBlock[];
	edges: CanvasEdge[];
};

/** Thrown for every payload we refuse; `message` is safe to show to the user. */
export class CanvasTransferError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CanvasTransferError";
	}
}

/**
 * Version upgrades, keyed by the version being upgraded *from*. Each entry
 * returns the document one version newer, so a v1 document reaching a v4 app
 * runs 1→2→3→4. Never edit a released migration — add the next one.
 */
const MIGRATIONS: Record<number, (doc: CanvasTransferDoc) => CanvasTransferDoc> = {
	// 1: current. Example of the next one:
	// 1: (doc) => ({ ...doc, version: 2, blocks: doc.blocks.map(renameField) }),
};

/* ---------------------------------------------------------------- base64 --- */

/**
 * Base64 so the payload survives every transport unchanged: the system
 * clipboard, a text field, a chat message, a shell copy. Raw JSON picks up
 * smart quotes, gets line-wrapped, and breaks on any block config holding
 * newlines or non-ASCII.
 */
export function toBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	// Byte by byte: String.fromCharCode(...bytes) blows the argument limit on a
	// graph of any real size.
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function fromBase64(encoded: string): string {
	const binary = atob(encoded.replace(/\s+/g, ""));
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------- encode/-de --- */

export function createTransferDoc(
	blocks: CanvasBlock[],
	edges: CanvasEdge[],
): CanvasTransferDoc {
	return {
		kind: TRANSFER_KIND,
		version: TRANSFER_VERSION,
		exportedAt: new Date().toISOString(),
		blocks,
		edges,
	};
}

/** Payload as it goes onto the clipboard or into a file. */
export function encodeTransfer(doc: CanvasTransferDoc): string {
	return toBase64(JSON.stringify(doc));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Structural check — enough to reject foreign payloads and truncated files. */
function assertShape(value: unknown): CanvasTransferDoc {
	if (!isRecord(value) || value.kind !== TRANSFER_KIND) {
		throw new CanvasTransferError("That isn't a Fluxify canvas payload.");
	}
	if (typeof value.version !== "number" || !Number.isInteger(value.version)) {
		throw new CanvasTransferError("This canvas payload has no usable version.");
	}
	if (!Array.isArray(value.blocks) || !Array.isArray(value.edges)) {
		throw new CanvasTransferError("This canvas payload is incomplete.");
	}
	return value as unknown as CanvasTransferDoc;
}

/**
 * Walks the document up to the current version. A newer document is refused
 * rather than guessed at — dropping fields we don't understand would silently
 * corrupt the user's flow.
 */
export function migrateTransfer(doc: CanvasTransferDoc): CanvasTransferDoc {
	if (doc.version > TRANSFER_VERSION) {
		throw new CanvasTransferError(
			`This canvas was exported by a newer version of Fluxify (v${doc.version}). Update to import it.`,
		);
	}
	let current = doc;
	while (current.version < TRANSFER_VERSION) {
		const migrate = MIGRATIONS[current.version];
		if (!migrate) {
			throw new CanvasTransferError(
				`Canvas payloads at version ${current.version} can no longer be imported.`,
			);
		}
		const next = migrate(current);
		// A migration that doesn't advance the version would spin forever.
		if (next.version <= current.version) {
			throw new CanvasTransferError("Canvas payload migration failed.");
		}
		current = next;
	}
	return current;
}

/**
 * Decodes and migrates a payload. Throws `CanvasTransferError` with a
 * user-readable message for anything we won't accept.
 */
export function decodeTransfer(encoded: string): CanvasTransferDoc {
	let json: string;
	try {
		json = fromBase64(encoded);
	} catch {
		throw new CanvasTransferError("That isn't a Fluxify canvas payload.");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new CanvasTransferError("This canvas payload is corrupted.");
	}
	return migrateTransfer(assertShape(parsed));
}

/** Non-throwing decode, for probing clipboard text that is usually not ours. */
export function tryDecodeTransfer(encoded: string): CanvasTransferDoc | null {
	try {
		return decodeTransfer(encoded);
	} catch {
		return null;
	}
}
