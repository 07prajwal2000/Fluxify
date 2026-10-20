import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BadRequestError } from "../../../errors/badRequestError";
import { assertCreator, type Caller } from "../service";
import { registerSourced } from "./archive";
import { hashFiles } from "./integrity";
import { pluginsRoot, readTree, SKIPPED } from "./tree";
import { validatePlugin } from "./validate";

/**
 * Plugins on a directory the operator mounts on the admin and on every worker
 * (`FLUXIFY_PLUGINS_DIR`): each subdirectory is one plugin, as `fluxify-cli
 * blocks build` leaves it. Discovery only reads `package.json` and
 * `fluxify.json`; registering walks the directory and applies the same checks
 * as a tarball. Nothing is imported.
 */
export type FsCandidate = { path: string; name?: string; version?: string; error?: string };

function root() {
	const dir = pluginsRoot();
	if (!dir)
		throw new BadRequestError(
			"No plugins directory is set. Mount one on the admin and the workers and set FLUXIFY_PLUGINS_DIR.",
		);
	return dir;
}

const readJson = async (path: string) => JSON.parse(await Bun.file(path).text());

/** the directory's immediate subdirectories (symlinks are not followed), sorted */
async function subdirectories(dir: string) {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
		throw new BadRequestError("The plugins directory cannot be read");
	});
	return entries
		.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIPPED.has(e.name))
		.map((e) => e.name)
		.sort();
}

/**
 * Lists what is in the plugins directory that looks like a plugin (has a
 * `fluxify.json`), with the name and version it claims. A bad file is listed
 * with its error rather than hidden.
 */
export async function discoverFsPlugins(): Promise<FsCandidate[]> {
	const base = root();
	const found: FsCandidate[] = [];
	for (const path of await subdirectories(base)) {
		if (!(await Bun.file(join(base, path, "fluxify.json")).exists())) continue;
		try {
			const [manifest, pkg] = await Promise.all([
				readJson(join(base, path, "fluxify.json")),
				readJson(join(base, path, "package.json")),
			]);
			found.push({ path, name: manifest.name, version: pkg.version });
		} catch (error) {
			found.push({
				path,
				error: `Cannot read package.json and fluxify.json: ${(error as Error).message}`,
			});
		}
	}
	return found;
}

/** registers one directory from the listing, so a path can never leave the plugins directory */
export async function addFsPlugin(projectId: string, path: string, caller: Caller) {
	assertCreator(caller, projectId);
	const base = root();
	if (!(await subdirectories(base)).includes(path))
		throw new BadRequestError(`'${path}' is not a directory in the plugins directory`);
	const files = await readTree(join(base, path));
	const { manifest, version } = validatePlugin(files);
	return registerSourced(projectId, {
		manifest,
		version,
		source: "fs",
		location: path,
		integrity: hashFiles(files),
	});
}
