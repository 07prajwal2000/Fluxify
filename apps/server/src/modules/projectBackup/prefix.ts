import { z } from "zod";

/**
 * Where a project's backups go in a bucket and how often (#1106). Pure: no
 * database, so the settings key map can import it.
 */

export const BACKUP_INTERVALS = ["daily", "weekly", "monthly"] as const;
export type BackupInterval = (typeof BACKUP_INTERVALS)[number];
export const MAX_BACKUP_RETENTION = 1000;

/**
 * One or more `/`-separated segments of letters, digits, `.`, `_` and `-`, each
 * starting with a letter or digit: no leading or trailing slash, no empty
 * segment, no `..`. Keys under it are always `<prefix>/<name>`, so prefix `a`
 * never reaches `ab/…`.
 */
export const backupPrefixSchema = z
	.string()
	.max(200)
	.regex(/^[A-Za-z0-9][\w.-]*(\/[A-Za-z0-9][\w.-]*)*$/, {
		message:
			"Use letters, digits, '.', '_' and '-', in segments separated by '/', with no leading or trailing '/'",
	});

/** a slug as a valid prefix (slugs are already close; this only guards the odd character) */
export const defaultPrefix = (slug: string) =>
	slug.replace(/[^\w.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "backups";

/** `20261116T000005Z`: ISO 8601 basic format, sorts by time as text and has no `:` */
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

/** `<prefix>/<stamp>-<id>`: the archive is this plus `.tar.gz`, its summary this plus `.meta.json` */
export const backupBase = (prefix: string, at: Date, id: string) => `${prefix}/${stamp(at)}-${id}`;
export const ARCHIVE_EXT = ".tar.gz";
export const META_EXT = ".meta.json";

/** a name directly under the prefix that this feature wrote; anything else in the bucket is left alone */
export const BACKUP_NAME = /^(\d{8}T\d{6}Z-[^/]+)\.(tar\.gz|meta\.json)$/;

export const META_KIND = "fluxify.project.backup-meta";

/** `.meta.json` as a reader checks it (#1107); the bucket is outside our control */
export const backupMetaSchema = z.object({
	kind: z.literal(META_KIND),
	backupId: z.string(),
	archive: z.string(),
	createdAt: z.string(),
	mode: z.enum(["backup", "template"]),
	format: z.number(),
	release: z.string(),
	sizeBytes: z.number(),
	source: z.object({ projectId: z.string(), name: z.string(), slug: z.string() }),
	sections: z.record(z.string(), z.number()),
	hasReadme: z.boolean(),
});

/** the tick fires at about the same time each day; this keeps "a day later" from slipping a day */
const SLACK_MS = 60 * 60_000;

/** whether a project whose last successful backup was at `last` is due another */
export function isDue(last: Date | null, interval: BackupInterval, now: Date) {
	if (!last) return true;
	const next = new Date(last);
	if (interval === "daily") next.setUTCDate(next.getUTCDate() + 1);
	else if (interval === "weekly") next.setUTCDate(next.getUTCDate() + 7);
	else next.setUTCMonth(next.getUTCMonth() + 1);
	return now.getTime() >= next.getTime() - SLACK_MS;
}
