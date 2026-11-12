import { z } from "zod";

/**
 * `manifest.json`, the one file of an archive that is never encrypted, so the
 * UI can show what a backup holds before restoring it. Only a summary goes
 * here: nothing in it may be secret.
 */
export const BACKUP_KIND = "fluxify.project";

/** The envelope's own version: the archive layout and this manifest. Sections version themselves. */
export const BACKUP_FORMAT = 1;

/**
 * The release that made the archive; informational only, nothing branches on it.
 * ponytail: images only carry VERSION as a label today; set FLUXIFY_VERSION
 * from it in the Dockerfiles when the release needs to show in the UI.
 */
export const RELEASE = process.env.FLUXIFY_VERSION || "dev";

export const manifestSchema = z.object({
	kind: z.literal(BACKUP_KIND),
	format: z.number().int().min(1),
	mode: z.enum(["backup", "template"]),
	release: z.string(),
	createdAt: z.string(),
	source: z.object({ name: z.string(), slug: z.string() }),
	/** section → its format version */
	sections: z.record(z.string(), z.number().int().min(1)),
	/** hash of the plain payload (`sections/`, `files/`), checked after decrypting */
	integrity: z.string(),
});

export type BackupManifest = z.infer<typeof manifestSchema>;
