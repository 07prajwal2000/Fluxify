import type { z } from "zod";
import type { DbTransactionType } from "../../db";

/**
 * `backup` keeps secrets and is encrypted with MASTER_ENCRYPTION_KEY, so it
 * restores only on an instance with the same key. `template` is plain and
 * carries no secret values: a module checks `ctx.mode` and blanks them.
 */
export type BackupMode = "backup" | "template";

export type BackupOptions = {
	/** canvas history beyond the promoted snapshot, which is always kept */
	includeVersionHistory: boolean;
	/** app config values; the keys are always kept. Always false in a template. */
	includeAppConfigValues: boolean;
};

/** binary payloads by path, relative to the module's own `files/<module>/` folder */
export type BackupFiles = Record<string, Uint8Array>;

export type ExportCtx = {
	projectId: string;
	mode: BackupMode;
	options: BackupOptions;
};

/**
 * Resources travel by name, as route bundles do: an id from the source
 * project means nothing in the new one. A module records the id each name got
 * (`ids.set("integrations", "pg-main", id)`) and a later module looks it up.
 * A name that resolves to nothing can mean its section was left out of the
 * backup, so decide whether to blank the reference or refuse.
 */
export type IdMap = {
	set(section: string, name: string, id: string): void;
	get(section: string, name: string): string | undefined;
};

/**
 * Where a restore writes (#1130). `new`: a project this restore just created,
 * empty. `existing`: a rollback into a live project, where every module
 * upserts by name (see README.md, "Rolling back in place").
 */
export type RestoreTarget = "new" | "existing";

export type ImportCtx = {
	tx: DbTransactionType;
	/** the project this restore writes into: a new one, or the one being rolled back */
	projectId: string;
	target: RestoreTarget;
	/**
	 * Exact replica (rollback only): once every section is in, the engine calls
	 * `prune` with what this section's backup lacks. Always false for `new`.
	 */
	prune: boolean;
	/**
	 * Rollback only, and only in a backup: a matching integration takes the
	 * backup's credentials and a matching app config key its values. Otherwise
	 * a match keeps today's.
	 */
	restoreSecrets: boolean;
	/**
	 * The id this section's resource of that name already has in the project,
	 * which a match keeps: update it in place and `ids.set` that id. Always
	 * undefined for a `new` target.
	 */
	match(name: string): string | undefined;
	/** what the archive was made as; a template has no secrets to restore */
	mode: BackupMode;
	/** the project the archive was made from, as the manifest names it */
	source: { name: string; slug: string };
	/** this module's files only. Untrusted: never write a path to disk unchecked. */
	files: BackupFiles;
	ids: IdMap;
	/**
	 * Work that reaches outside Postgres (NATS schedules, trigger artifacts),
	 * run by `restoreBackup` once the transaction has committed, so a rolled-back
	 * restore leaves nothing behind. It reads the committed rows, never `tx`.
	 * A failure never fails the restore: it is logged and `warning` is returned
	 * to the user, so say what didn't happen and how to fix it.
	 */
	afterCommit(work: () => Promise<void>, warning: string): void;
	/**
	 * Something only the database could tell (a subdomain already taken here), to
	 * return with the restore's warnings. The restore goes on; refuse with a
	 * `BadRequestError` instead when it must not.
	 */
	warn(message: string): void;
};

/** something the user should know about restoring a section on this instance */
export type RestoreWarning = { section: string; message: string };

/** a canvas as the portal's read-only canvas draws it */
export type PreviewCanvas = {
	blocks: { id: string; type: string; position: { x: number; y: number }; data: unknown }[];
	edges: {
		id: string;
		from: string;
		to: string;
		fromHandle: string | null;
		toHandle: string | null;
	}[];
};

/**
 * One resource of a section as the restore dialog shows it, read only. Never a
 * secret: integration config and app config values stay out, whatever the mode.
 */
export type PreviewItem = {
	name: string;
	/** one line under the name, e.g. `GET /orders` */
	summary?: string;
	/** label → value, in the order shown */
	details?: Record<string, string | number | boolean | null>;
	canvas?: PreviewCanvas;
};

/**
 * One resource type in a project backup. Adding a resource is adding one of
 * these to `BACKUP_MODULES` (`modules.ts`); see README.md.
 */
export type BackupModule<T = unknown> = {
	/** the section key in the archive: stable forever */
	name: string;
	/** the current format version; bump it when the shape of `T` changes */
	version: number;
	/** the oldest version `upgrades` still walks up from */
	minSupported: number;
	/** version → the last Fluxify release that restores it, for the "too old" message */
	lastReleaseFor?: Record<number, string>;
	/** sections that must import first (their ids are in `ctx.ids`) */
	dependsOn: string[];
	/** the current shape; every section is parsed with it before anything is written */
	schema: z.ZodType<T>;
	/** keyed by the version upgraded FROM. Pure, and never edited once released. */
	upgrades: Record<number, (data: unknown) => unknown>;
	/**
	 * Warnings about restoring this (upgraded, parsed) section on this instance,
	 * shown before the user confirms. Pure apart from reading instance settings:
	 * no database, nothing written. `read(section)` gives a section read before
	 * this one (its `dependsOn` among them), parsed; undefined when the archive
	 * has none. `archive` holds this module's files (untrusted) and the mode.
	 * A throw refuses the archive here, before the user fills anything in.
	 */
	inspect?(
		data: T,
		read: (section: string) => unknown,
		archive: { files: BackupFiles; mode: BackupMode },
	): string[] | Promise<string[]>;
	/**
	 * The section's resources for the restore dialog, as they will be restored
	 * in `mode` (a template's production switches show off). No secrets.
	 */
	preview?(data: T, mode: BackupMode): PreviewItem[];
	export(ctx: ExportCtx): Promise<{ data: T; files?: BackupFiles }>;
	/** an upsert by name: see `ImportCtx.match`. A `new` target never matches. */
	import(ctx: ImportCtx, data: T): Promise<void>;

	/*
	 * Rolling back in place (#1130). A module that holds named resources gives
	 * all four of `existing`, `names`, `prune` and `uses` it can; one without
	 * them is restored over what is there and never pruned.
	 */
	/** the project's resources of this section, name → id (the first, should a name repeat) */
	existing?(projectId: string, tx: DbTransactionType): Promise<Map<string, string>>;
	/** the names the backup's section holds, as `existing` keys them */
	names?(data: T): string[];
	/**
	 * Exact replica: deletes `stale` (in the project, not in the backup), in
	 * `ctx.tx`, after every section is in, in reverse dependency order. Called
	 * even when `stale` is empty, with the section's `data`, for what a module
	 * keeps inside a section (trigger groups). What lives outside Postgres
	 * (artifacts, schedules) goes in `ctx.afterCommit`.
	 */
	prune?(ctx: ImportCtx, stale: { name: string; id: string }[], data: T): Promise<void>;
	/**
	 * What each resource of this (exported) section uses in other sections, by
	 * name, so a rollback refuses to prune something a resource it keeps uses.
	 */
	uses?(data: T): Use[];
	/**
	 * Refusals only this section can find, e.g. a route path an extra route
	 * already serves. Read only.
	 */
	conflicts?(data: T, projectId: string, tx: DbTransactionType): Promise<RollbackConflict[]>;
};

/** `Route "orders"` uses the custom block `user_defined.project.auth` */
export type Use = { owner: string; section: string; name: string };

/**
 * Something that stops a rollback, and when: in `mode`, with every section of
 * `selected` restored and none of `kept`. The dialog evaluates it as the user
 * changes the choices; the rollback itself refuses it before writing anything.
 */
export type RollbackConflict = {
	message: string;
	mode: "keep" | "exact";
	selected: string[];
	kept: string[];
};
