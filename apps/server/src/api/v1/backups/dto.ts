import { z } from "zod";
import { BACKUP_STATUSES, BACKUP_TYPES } from "../../../db/schema";
import { MAX_README_BYTES } from "../../../modules/projectBackup/archive";

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
	createdBy: z.object({ email: z.string(), name: z.string().nullable() }).nullable(),
	createdAt: z.date(),
	finishedAt: z.date().nullable(),
});

export const listResponseSchema = z.object({
	backups: z.array(backupSchema),
	retentionDays: z.number(),
});
