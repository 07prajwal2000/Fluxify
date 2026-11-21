import { z } from "zod";
import { BACKUP_STATUSES, BACKUP_TYPES } from "../../../db/schema";
import { MAX_README_BYTES } from "../../../modules/projectBackup/archive";
import { gitSettingsSchema } from "../../../modules/projectBackup/gitSettings";
import {
	BACKUP_INTERVALS,
	backupMetaSchema,
	backupPrefixSchema,
	MAX_BACKUP_RETENTION,
} from "../../../modules/projectBackup/prefix";
import { inspectResponseSchema, newProjectSchema, warningSchema } from "../projects/restore/dto";

export const projectParamSchema = z.object({ projectId: z.string() });
export const idParamSchema = projectParamSchema.extend({ id: z.string() });

export const startBodySchema = z.object({
	mode: z
		.enum(["backup", "template"])
		.describe("backup keeps secrets and is encrypted; template carries none and is plain"),
	sections: z.array(z.string().min(1)).min(1).describe("the resource sections to include"),
	includeVersionHistory: z.boolean().default(false),
	includeAppConfigValues: z.boolean().default(false),
	readme: z
		.string()
		.max(MAX_README_BYTES)
		.optional()
		.describe("Markdown stored unencrypted in the archive; remembered for the next backup"),
});

export const idResponseSchema = z.object({ id: z.string() });

export const sectionsResponseSchema = z.object({
	sections: z.array(z.object({ name: z.string(), dependsOn: z.array(z.string()) })),
});

export const backupSchema = z.object({
	id: z.string(),
	type: z.enum(BACKUP_TYPES),
	mode: z.enum(["backup", "template"]),
	sections: z.array(z.string()),
	formatVersions: z.record(z.string(), z.number()),
	release: z.string().nullable(),
	sizeBytes: z.number().nullable(),
	status: z.enum(BACKUP_STATUSES),
	error: z.string().nullable(),
	/** a finished manual archive that is still held */
	downloadable: z.boolean(),
	expiresAt: z.date().nullable(),
	/** the bucket key of an object storage backup, or a git commit's SHA */
	destinationKey: z.string().nullable(),
	/** why it was taken, e.g. "Before rollback" (#1130); null for one made by hand or on schedule */
	label: z.string().nullable(),
	createdBy: z.object({ email: z.string(), name: z.string().nullable() }).nullable(),
	createdAt: z.date(),
	finishedAt: z.date().nullable(),
});

export const listResponseSchema = z.object({
	backups: z.array(backupSchema),
	retentionDays: z.number(),
});

/** backups to object storage (#1106) */
export const scheduleBodySchema = z.object({
	integrationId: z.string().min(1).describe("an Object Storage integration of this project"),
	prefix: backupPrefixSchema.describe("where in the bucket; unique to this project"),
	interval: z.enum(BACKUP_INTERVALS),
	retention: z.number().int().min(1).max(MAX_BACKUP_RETENTION).describe("backups to keep"),
	enabled: z.boolean(),
	sections: z.array(z.string().min(1)).min(1),
	includeVersionHistory: z.boolean().default(false),
	includeAppConfigValues: z.boolean().default(false),
});

export const scheduleResponseSchema = z.object({
	schedule: scheduleBodySchema.extend({
		integrationId: z.string().nullable(),
		prefix: z.string(),
	}),
	/** what the prefix starts as: the project's slug */
	defaultPrefix: z.string(),
	/** the newest object storage run, whatever its outcome */
	lastRun: backupSchema.nullable(),
});

/** backups read back from a bucket (#1107) */
export const remoteQuerySchema = z.object({
	integrationId: z.string().min(1).describe("an Object Storage integration of this project"),
	prefix: backupPrefixSchema.describe("the folder whose backups to list"),
});
export const prefixesQuerySchema = remoteQuerySchema.pick({ integrationId: true });
export const remoteKeySchema = prefixesQuerySchema.extend({
	key: z.string().min(1).max(500).describe("the archive's key, as the listing returned it"),
});
export const remoteRestoreBodySchema = newProjectSchema.extend(remoteKeySchema.shape);

export const remoteListResponseSchema = z.object({
	backups: z.array(backupMetaSchema.extend({ key: z.string() })),
});
export const prefixesResponseSchema = z.object({ prefixes: z.array(z.string()) });

/** rolling a project back in place (#1130) */
export const rollbackChoiceSchema = z.object({
	mode: z
		.enum(["keep", "exact"])
		.describe("keep: leave what the backup lacks; exact: remove it, in the chosen sections"),
	sections: z.array(z.string().min(1)).min(1).describe("the archive's sections to restore"),
	restoreSecrets: z
		.boolean()
		.default(false)
		.describe("a backup's credentials and app config values over today's"),
});
export const remoteRollbackBodySchema = rollbackChoiceSchema.extend(remoteKeySchema.shape);

const conditionSchema = z.object({
	message: z.string(),
	mode: z.enum(["keep", "exact"]),
	selected: z.array(z.string()),
	kept: z.array(z.string()),
});

export const rollbackInspectResponseSchema = inspectResponseSchema
	.omit({ suggested: true })
	.extend({
		rollback: z.object({
			sections: z.array(
				z.object({
					section: z.string(),
					update: z.array(z.string()),
					create: z.array(z.string()),
					/** only in the project: kept, or removed by an exact replica */
					extras: z.array(z.string()),
					/** no named resources: restored over what is there */
					replaced: z.boolean(),
				}),
			),
			/** active in `mode` when every `selected` section is restored and no `kept` one is */
			conflicts: z.array(conditionSchema),
			/**
			 * Warnings under the same rule, never refusals: the archive's, resolved
			 * against this project, and what an exact replica's removals may break.
			 * The top-level `warnings` are these for keep extras and every section.
			 */
			notes: z.array(
				conditionSchema.extend({
					section: z.string(),
					/** about what an exact replica removes: shown beside the removal list */
					removal: z.boolean().optional(),
				}),
			),
		}),
	});

export const rollbackResponseSchema = z.object({
	/** the backup of the project as it was, taken first */
	backupId: z.string(),
	warnings: z.array(warningSchema),
});

/** commits to a git repository (#1150) */
export const gitSettingsResponseSchema = z.object({
	settings: gitSettingsSchema.extend({
		url: z.string(),
		username: z.string(),
		token: z.string(),
	}),
	/** what the folder starts as: the project's slug */
	defaultPath: z.string(),
});
export const gitCommitBodySchema = z.object({
	message: z.string().trim().min(1).max(5000).describe("the commit message"),
});
export const gitCommitsResponseSchema = z.object({
	commits: z.array(
		z.object({ sha: z.string(), message: z.string(), author: z.string(), date: z.string() }),
	),
});
export const gitShaSchema = z.object({
	sha: z
		.string()
		.regex(/^[0-9a-f]{40}$/)
		.describe("a commit the listing returned"),
});
export const gitRestoreBodySchema = newProjectSchema.extend(gitShaSchema.shape);
