import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BadRequestError } from "../../../errors/badRequestError";
import { MAX_ENTRIES, MAX_UNPACKED_BYTES } from "./limits";
import type { PluginFiles } from "./tar";

/**
 * A plugin on a directory the operator mounts on the admin and on every worker
 * (`FLUXIFY_PLUGINS_DIR`). Kept apart from the registry code so a worker can
 * read the same tree, and hash it, without loading the admin's services.
 */
export const pluginsRoot = () => process.env.FLUXIFY_PLUGINS_DIR || undefined;

/** not part of a plugin: dependencies are installed from `bun.lock`, and `.git` is history */
export const SKIPPED = new Set(["node_modules", ".git"]);

/** every file below `dir` as a relative posix path, within the same caps as a tarball */
export async function readTree(dir: string) {
	const files: PluginFiles = new Map();
	let bytes = 0;
	const walk = async (relative: string) => {
		for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
			if (SKIPPED.has(entry.name)) continue;
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path);
			else if (!entry.isFile())
				throw new BadRequestError(
					`'${path}' is a link or special file; plugins ship plain files only`,
				);
			else {
				const content = await Bun.file(join(dir, path)).bytes();
				bytes += content.length;
				if (files.size >= MAX_ENTRIES || bytes > MAX_UNPACKED_BYTES)
					throw new BadRequestError(
						`The plugin is over the size limit (${MAX_ENTRIES} files, ${MAX_UNPACKED_BYTES / 1024 / 1024} MB)`,
					);
				files.set(path, content);
			}
		}
	};
	await walk("");
	return files;
}
