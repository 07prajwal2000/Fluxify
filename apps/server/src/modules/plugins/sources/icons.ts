import { extname } from "node:path";
import { type FluxifyManifest, ICON_URL_MAX } from "@fluxify/sdk/blocks";
import { BadRequestError } from "../../../errors/badRequestError";
import type { PluginFiles } from "./tar";

const MIME: Record<string, string> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
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

type Holder = { icon?: string; scopeIcon?: string };

/**
 * Every icon a manifest holds, so the conversion, the backfill and the API
 * guard all read one list: the plugin's and its scope's, then each block's,
 * integration's and trigger's. `label` is what an error calls it.
 */
function* manifestIcons(m: FluxifyManifest): Generator<[Holder, "icon" | "scopeIcon", string]> {
	yield [m, "icon", m.name];
	yield [m, "scopeIcon", `${m.name} scope`];
	for (const [type, block] of Object.entries(m.blocks)) yield [block, "icon", type];
	for (const e of [...(m.integrations ?? []), ...(m.triggers ?? [])]) yield [e, "icon", e.name];
}

/**
 * The stored manifest carries each icon as a data URL, not a path into the
 * tarball. A bad icon refuses the plugin; with `onDropped` (the backfill of a
 * row stored earlier) it is removed instead, and reported.
 */
export function inlineManifestIcons(
	files: PluginFiles,
	manifest: FluxifyManifest,
	onDropped?: (label: string, error: Error) => void,
) {
	for (const [holder, key, label] of manifestIcons(manifest)) {
		if (!holder[key]) continue;
		try {
			holder[key] = iconDataUrl(files, label, holder[key]);
		} catch (error) {
			if (!onDropped) throw error;
			delete holder[key];
			onDropped(label, error as Error);
		}
	}
}

const isPath = (icon?: string) => !!icon && !icon.startsWith("data:");

/** whether a stored manifest still has an icon that is a path into a tarball */
export const hasPathIcon = (m: FluxifyManifest) =>
	[...manifestIcons(m)].some(([holder, key]) => isPath(holder[key]));

/**
 * A copy of the manifest with every icon that is not a data URL dropped, so an
 * API never hands out a path the browser would resolve against the portal.
 */
export function withDataIcons(manifest: FluxifyManifest): FluxifyManifest {
	const out = structuredClone(manifest);
	for (const [holder, key] of manifestIcons(out)) if (isPath(holder[key])) delete holder[key];
	return out;
}

/** one plugin icon for a response: the data URL, or nothing */
export const dataIcon = (icon?: string) => (isPath(icon) ? undefined : icon);
