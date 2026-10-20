import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PluginMeta } from "@fluxify/sdk";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { dependencyProblems } from "@fluxify/sdk/runtime";
import { fail } from "./fail";
import { INDEX, readMeta, syncPackageJson } from "./meta";

export { CliError, fail } from "./fail";

export type Plugin = {
	root: string;
	/** scope/name */
	name: string;
	url: string;
	/** everything `src/index.ts` says: name, url, icons, description */
	meta: PluginMeta;
	/** the range of `@fluxify/sdk` the plugin peers on */
	sdk: string;
	version: string;
	/** every dependency and peer dependency: installed or provided by the worker, so never bundled */
	external: string[];
};

const readJson = async (path: string) => JSON.parse(await Bun.file(path).text());

/** a plugin package.json: one with `fluxify`, or one on the SDK beside a `src/index.ts` (build adds `fluxify`) */
const isPlugin = (dir: string, pkg: any) =>
	!!pkg?.fluxify ||
	(!!{ ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies }["@fluxify/sdk"] &&
		existsSync(join(dir, INDEX)));

/** the nearest plugin directory at or above `from` */
export async function findPluginRoot(from: string): Promise<string | undefined> {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		const file = join(dir, "package.json");
		if (existsSync(file) && isPlugin(dir, await readJson(file).catch(() => null))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

/**
 * Reads the plugin at `root`: its metadata from `src/index.ts` (written into
 * package.json's `fluxify` when missing), failing on drift between the two, an
 * invalid version or SDK range, a host package in `dependencies`, or runtime
 * dependencies without a usable lockfile.
 */
export async function readPlugin(root: string, { lockfile = true } = {}): Promise<Plugin> {
	const pkg = await readJson(join(root, "package.json")).catch(() =>
		fail(`${root} has no readable package.json`),
	);
	const meta = await readMeta(root);
	await syncPackageJson(root, pkg, meta);
	const problems: string[] = [];
	if (typeof pkg.version !== "string" || !pkg.version)
		problems.push(`package.json "version" is required`);
	const range = pkg.peerDependencies?.["@fluxify/sdk"];
	const sdk = fluxifyManifestSchema.shape.sdk.safeParse(range);
	if (!sdk.success)
		problems.push(
			range
				? `@fluxify/sdk range "${range}" must be >=, ^ or ~ followed by one version, like >=2026.10.2001`
				: `package.json must list @fluxify/sdk in peerDependencies`,
		);
	if (lockfile) {
		const lock = join(root, "bun.lock");
		problems.push(
			...dependencyProblems(pkg, existsSync(lock) ? await Bun.file(lock).text() : undefined),
		);
	}
	if (problems.length) fail(...problems);
	return {
		root,
		name: meta.name,
		url: meta.url,
		meta,
		sdk: sdk.data!,
		version: pkg.version,
		external: [
			...Object.keys({
				...pkg.dependencies,
				...pkg.peerDependencies,
				...pkg.optionalDependencies,
			}),
		],
	};
}
