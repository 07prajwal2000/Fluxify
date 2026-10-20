import { createHash } from "node:crypto";
import { BadRequestError } from "../../../errors/badRequestError";
import type { PluginFiles } from "./tar";

/**
 * Integrity strings are Subresource Integrity, `<algorithm>-<base64>`, the form
 * npm's `dist.integrity` already uses, so a worker verifies every source with
 * one function.
 */
const ALGORITHMS = ["sha256", "sha384", "sha512"];

export const sha256Integrity = (bytes: Uint8Array) =>
	`sha256-${createHash("sha256").update(bytes).digest("base64")}`;

/**
 * The hash of a directory: every file by sorted path, each framed by its path
 * and length so moving bytes between files changes it.
 */
export function hashFiles(files: PluginFiles) {
	const hash = createHash("sha256");
	for (const path of [...files.keys()].sort()) {
		const bytes = files.get(path)!;
		hash.update(`${path}\0${bytes.length}\0`).update(bytes);
	}
	return `sha256-${hash.digest("base64")}`;
}

/** Throws unless `bytes` match `integrity` (a registry may list several hashes; each one we understand must match). */
export function verifyIntegrity(bytes: Uint8Array, integrity: string) {
	const known = integrity
		.trim()
		.split(/\s+/)
		.map((token) => token.split("-", 2) as [string, string])
		.filter(([algorithm]) => ALGORITHMS.includes(algorithm));
	if (!known.length)
		throw new BadRequestError(`The registry gave no integrity hash we can check ('${integrity}')`);
	for (const [algorithm] of known) {
		const actual = `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;
		if (!integrity.split(/\s+/).includes(actual))
			throw new BadRequestError(
				"The downloaded package does not match the registry's integrity hash; refusing it",
			);
	}
}
