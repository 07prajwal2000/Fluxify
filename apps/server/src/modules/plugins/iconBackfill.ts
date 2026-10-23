import { logger } from "@fluxify/common";
import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { db } from "../../db";
import { pluginsEntity } from "../../db/schema";
import { fetchPluginFiles } from "./install/source";
import { updatePluginRow } from "./repository";
import { hasPathIcon, inlineManifestIcons } from "./sources/icons";

/**
 * Plugins stored before every icon was kept as a data URL still hold paths into
 * a tarball (#977). Each path is read from the stored package and replaced; one
 * the package cannot give (the tarball is gone, the file is not in it) is
 * removed and logged, so the portal falls back to its default. Idempotent: a
 * manifest with no path left is not touched, so it runs on every start.
 */
type Source = Parameters<typeof fetchPluginFiles>[0];

async function inlined(manifest: FluxifyManifest, source: Source, plugin: string) {
	if (!hasPathIcon(manifest)) return undefined;
	const files = await fetchPluginFiles(source).catch((error: Error) => {
		logger.warn(
			`plugin ${plugin}: icons dropped, its package is unavailable: ${error.message}`,
			"PLUGINS",
		);
		return new Map();
	});
	const next = structuredClone(manifest);
	inlineManifestIcons(files, next, (label, error) =>
		logger.warn(`plugin ${plugin}: icon dropped, ${error.message}`, "PLUGINS", { label }),
	);
	return next;
}

export async function backfillPluginIcons() {
	for (const row of await db.select().from(pluginsEntity)) {
		// a row that cannot be fixed must not keep the server from starting
		try {
			const manifest = await inlined(row.manifest, row, row.name);
			const live = row.live && (await inlined(row.live.manifest, row.live, row.name));
			if (!manifest && !live) continue;
			await updatePluginRow(row.id, {
				...(manifest && { manifest }),
				...(live && { live: { ...row.live!, manifest: live } }),
			});
			logger.info(`plugin ${row.name}@${row.version}: icons stored as data URLs`, "PLUGINS");
		} catch (error) {
			logger.error(`plugin ${row.name}: icon backfill failed: ${String(error)}`, "PLUGINS");
		}
	}
}
