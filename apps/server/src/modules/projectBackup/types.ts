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

export type ImportCtx = {
	tx: DbTransactionType;
	/** the project being created by this restore */
	projectId: string;
	/** what the archive was made as; a template has no secrets to restore */
	mode: BackupMode;
	/** this module's files only. Untrusted: never write a path to disk unchecked. */
	files: BackupFiles;
	ids: IdMap;
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
	export(ctx: ExportCtx): Promise<{ data: T; files?: BackupFiles }>;
	import(ctx: ImportCtx, data: T): Promise<void>;
};
