import { extname } from "node:path";
import { type FluxifyManifest, fluxifyManifestSchema, ICON_URL_MAX } from "@fluxify/sdk/blocks";
import { z } from "zod";
import { BadRequestError } from "../../../errors/badRequestError";
import type { PluginFiles } from "./tar";

/**
 * The checks every plugin passes, whichever source it came from: a tarball
 * (upload, npm, url) or a directory (fs) is first reduced to its files, and
 * these rules read only `package.json`, `fluxify.json` and icons. No plugin code
 * is imported or run here.
 */
export type ValidPlugin = { manifest: FluxifyManifest; version: string };

const MIME: Record<string, string> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

const json = (files: PluginFiles, path: string): unknown => {
	try {
		return JSON.parse(new TextDecoder().decode(files.get(path)));
	} catch {
		throw new BadRequestError(`${path} is not valid JSON`);
	}
};

/** the icon, as the portal would store it: a base64 data URL, which has a length limit */
function checkIcon(files: PluginFiles, type: string, icon: string) {
	const path = icon.replace(/^\.\//, "");
	// a path that climbs or is absolute never names a file in the plugin, whatever the map holds
	const bytes =
		path.startsWith("/") || path.split("/").includes("..") ? undefined : files.get(path);
	if (!bytes) throw new BadRequestError(`${type}: icon '${icon}' is not in the plugin`);
	const mime = MIME[extname(path).toLowerCase()];
	if (!mime)
		throw new BadRequestError(`${type}: icon '${icon}' must be ${Object.keys(MIME).join(", ")}`);
	const length = `data:${mime};base64,`.length + Math.ceil(bytes.length / 3) * 4;
	if (length > ICON_URL_MAX)
		throw new BadRequestError(
			`${type}: icon '${icon}' is ${length} characters as a data URL; the limit is ${ICON_URL_MAX}`,
		);
}

/** Throws a `BadRequestError` naming the first rule the files break. */
export function validatePlugin(files: PluginFiles): ValidPlugin {
	for (const required of ["package.json", "bun.lock", "fluxify.json"])
		if (!files.has(required)) throw new BadRequestError(`The plugin has no ${required}`);
	for (const path of files.keys())
		if (path.split("/").includes("node_modules"))
			throw new BadRequestError(
				`The plugin ships '${path}'; dependencies are installed from bun.lock, never shipped`,
			);

	const pkg = json(files, "package.json") as { version?: unknown; fluxify?: { name?: unknown } };
	if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version))
		throw new BadRequestError(
			`package.json "version" must be an exact version like 2026.10.2001, got '${String(pkg.version)}'`,
		);

	const parsed = fluxifyManifestSchema.safeParse(json(files, "fluxify.json"));
	if (!parsed.success)
		throw new BadRequestError(`Invalid fluxify.json: ${z.prettifyError(parsed.error)}`);
	const manifest = parsed.data;
	if (pkg.fluxify?.name !== manifest.name)
		throw new BadRequestError(
			`package.json says the plugin is '${String(pkg.fluxify?.name)}' but fluxify.json says '${manifest.name}'`,
		);

	for (const [type, block] of Object.entries(manifest.blocks)) {
		if (!block.entry.startsWith("dist/") || !files.has(block.entry))
			throw new BadRequestError(`${type}: its entry '${block.entry}' is not in the plugin's dist/`);
		if (block.icon) checkIcon(files, type, block.icon);
	}
	return { manifest, version: pkg.version };
}
