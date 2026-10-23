import { blockIdProblem } from "@fluxify/sdk";
import { type FluxifyManifest, fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { dependencyProblems, SDK_VERSION } from "@fluxify/sdk/runtime";
import { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import { inlineManifestIcons } from "./icons";
import type { PluginFiles } from "./tar";

/**
 * The checks every plugin passes, whichever source it came from: a tarball
 * (upload, npm, url) or a directory (fs) is first reduced to its files, and
 * these rules read only `package.json`, `bun.lock`, `fluxify.json` and icons.
 * No plugin code is imported or run here.
 */
export type ValidPlugin = { manifest: FluxifyManifest; version: string };

const json = (files: PluginFiles, path: string): unknown => {
	try {
		return JSON.parse(new TextDecoder().decode(files.get(path)));
	} catch {
		throw new BadRequestError(`${path} is not valid JSON`);
	}
};

/** Throws a `BadRequestError` naming the first rule the files break. */
export function validatePlugin(files: PluginFiles): ValidPlugin {
	// bun.lock only when there are runtime dependencies: `dependencyProblems` below
	for (const required of ["package.json", "fluxify.json"])
		if (!files.has(required)) throw new BadRequestError(`The plugin has no ${required}`);
	for (const path of files.keys())
		if (path.split("/").includes("node_modules"))
			throw new BadRequestError(
				`The plugin ships '${path}'; dependencies are installed from bun.lock, never shipped`,
			);

	const pkg = json(files, "package.json") as {
		version?: unknown;
		fluxify?: { name?: unknown };
		dependencies?: Record<string, string>;
	};
	if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version))
		throw new BadRequestError(
			`package.json "version" must be an exact version like 2026.10.2001, got '${String(pkg.version)}'`,
		);
	const lock = files.get("bun.lock");
	const [problem] = dependencyProblems(pkg, lock && new TextDecoder().decode(lock));
	if (problem) throw new BadRequestError(problem);

	const parsed = fluxifyManifestSchema.safeParse(json(files, "fluxify.json"));
	if (!parsed.success)
		throw new BadRequestError(`Invalid fluxify.json: ${z.prettifyError(parsed.error)}`);
	const manifest = parsed.data;
	if (!Bun.semver.satisfies(SDK_VERSION, manifest.sdk))
		throw new BadRequestError(
			`The plugin needs @fluxify/sdk ${manifest.sdk}, but this Fluxify provides ${SDK_VERSION}`,
		);
	if (pkg.fluxify?.name !== manifest.name)
		throw new BadRequestError(
			`package.json says the plugin is '${String(pkg.fluxify?.name)}' but fluxify.json says '${manifest.name}'`,
		);
	// every span of a block this plugin provides records this id (#952); one that
	// could not fit the column is refused here, naming the block
	const idProblem = blockIdProblem(manifest.name, pkg.version, Object.keys(manifest.blocks));
	if (idProblem) throw new BadRequestError(idProblem);

	// a module the manifest names has to be in the package, and where the CLI builds it
	const entries: [string, string][] = [
		...Object.entries(manifest.blocks).map(([type, b]): [string, string] => [type, b.entry]),
		...[...(manifest.integrations ?? []), ...(manifest.triggers ?? [])].map(
			(e): [string, string] => [e.name, e.entry],
		),
	];
	for (const [name, entry] of entries)
		if (!entry.startsWith("dist/") || !files.has(entry))
			throw new BadRequestError(`${name}: its entry '${entry}' is not in the plugin's dist/`);
	inlineManifestIcons(files, manifest);
	return { manifest, version: pkg.version };
}
