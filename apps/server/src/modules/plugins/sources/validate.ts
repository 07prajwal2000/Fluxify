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

const tooLong = (type: string, icon: string, length: number) =>
	new BadRequestError(
		`${type}: icon '${icon.slice(0, 80)}' is ${length} characters as a data URL; the limit is ${ICON_URL_MAX}`,
	);

/**
 * The icon as the portal stores a custom block's: a base64 data URL, which has
 * a length limit. A path names a file only the tarball holds, so it is read
 * here; a data URL already is the value.
 */
function iconDataUrl(files: PluginFiles, type: string, icon: string): string {
	if (icon.startsWith("data:")) {
		if (icon.length > ICON_URL_MAX) throw tooLong(type, icon, icon.length);
		return icon;
	}
	const path = icon.replace(/^\.\//, "");
	// a path that climbs or is absolute never names a file in the plugin, whatever the map holds
	const bytes =
		path.startsWith("/") || path.split("/").includes("..") ? undefined : files.get(path);
	if (!bytes) throw new BadRequestError(`${type}: icon '${icon}' is not in the plugin`);
	const mime = MIME[extname(path).toLowerCase()];
	if (!mime)
		throw new BadRequestError(`${type}: icon '${icon}' must be ${Object.keys(MIME).join(", ")}`);
	const prefix = `data:${mime};base64,`;
	const length = prefix.length + Math.ceil(bytes.length / 3) * 4;
	if (length > ICON_URL_MAX) throw tooLong(type, icon, length);
	return prefix + Buffer.from(bytes).toString("base64");
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

	// the stored manifest carries each icon as a data URL, not a path into the tarball
	for (const [type, block] of Object.entries(manifest.blocks)) {
		if (!block.entry.startsWith("dist/") || !files.has(block.entry))
			throw new BadRequestError(`${type}: its entry '${block.entry}' is not in the plugin's dist/`);
		if (block.icon) block.icon = iconDataUrl(files, type, block.icon);
	}
	return { manifest, version: pkg.version };
}
