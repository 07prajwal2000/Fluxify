import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { dependencyProblems } from "@fluxify/sdk/runtime";
import { z } from "zod";

/** a failure the author can act on: printed as one line each, exit code 1 */
export class CliError extends Error {
	constructor(readonly problems: string[]) {
		super(problems.join("\n"));
	}
}
export const fail = (...problems: string[]): never => {
	throw new CliError(problems);
};

export type Plugin = {
	root: string;
	/** scope/name */
	name: string;
	url: string;
	/** the range of `@fluxify/sdk` the plugin peers on */
	sdk: string;
	version: string;
	/** every dependency and peer dependency: installed or provided by the worker, so never bundled */
	external: string[];
};

const readJson = async (path: string) => JSON.parse(await Bun.file(path).text());

/** the nearest directory at or above `from` whose package.json has a `fluxify` key */
export async function findPluginRoot(from: string): Promise<string | undefined> {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		const file = join(dir, "package.json");
		if (existsSync(file) && (await readJson(file).catch(() => null))?.fluxify) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

/** `fluxify.*` and the SDK range, checked with the schema the registry will use */
const metaSchema = z.object({
	version: z.string().min(1),
	fluxify: z.object({
		name: fluxifyManifestSchema.shape.name,
		url: fluxifyManifestSchema.shape.url,
	}),
});

/**
 * Reads the plugin at `root`, failing on missing or invalid metadata, a host
 * package in `dependencies`, or runtime dependencies without a usable lockfile.
 */
export async function readPlugin(root: string, { lockfile = true } = {}): Promise<Plugin> {
	const pkg = await readJson(join(root, "package.json")).catch(() =>
		fail(`${root} has no readable package.json`),
	);
	const problems: string[] = [];
	const meta = metaSchema.safeParse({
		...pkg,
		fluxify: { name: undefined, url: undefined, ...pkg.fluxify },
	});
	if (!meta.success)
		for (const issue of meta.error.issues) {
			const path = issue.path.join(".");
			const missing = issue.code === "invalid_type";
			problems.push(
				`package.json "${path}" ${missing ? "is required" : issue.message}` +
					(path === "fluxify.url" ? " (where the docs and source live)" : ""),
			);
		}
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
		name: meta.data!.fluxify.name,
		url: meta.data!.fluxify.url,
		sdk: sdk.data!,
		version: meta.data!.version,
		external: [
			...Object.keys({
				...pkg.dependencies,
				...pkg.peerDependencies,
				...pkg.optionalDependencies,
			}),
		],
	};
}
