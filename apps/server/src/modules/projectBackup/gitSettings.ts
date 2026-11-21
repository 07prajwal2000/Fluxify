import { z } from "zod";

/**
 * Where a project's git backups go (#1150), kept as project settings. Written
 * only through `PUT /v1/:projectId/backups/git`; the generic settings write
 * refuses them. A restored project gets none of them (see
 * `resources/projectSettings.ts`), so a copy never pushes to the source's branch.
 */
export const GIT_KEY_PREFIX = "settings.backup.git.";
export const GIT_KEYS = {
	url: "settings.backup.git.url",
	branch: "settings.backup.git.branch",
	path: "settings.backup.git.path",
	username: "settings.backup.git.username",
	token: "settings.backup.git.token",
	encryptSecrets: "settings.backup.git.encryptSecrets",
} as const;

/** folders and branch names: plain segments, none starting with a dot (so never `.git` or `..`) */
const SEGMENTS = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

export const gitUrlSchema = z
	.string()
	.max(500)
	.regex(/^https?:\/\/[^\s/@]+(\/\S*)?$/, {
		message: "Use an http:// or https:// URL without a username or password in it",
	});
export const gitBranchSchema = z
	.string()
	.max(200)
	.regex(SEGMENTS, { message: "Not a valid branch name" })
	.refine((v) => !v.endsWith(".lock") && !v.includes(".."), { message: "Not a valid branch name" });
export const gitPathSchema = z
	.string()
	.max(200)
	.refine((v) => v === "" || SEGMENTS.test(v), {
		message: "Use a folder like backups/my-project, or leave it empty for the repository's root",
	});
/** the name of an app config key holding the value, as `cfg:KEY` */
export const cfgRefSchema = z
	.string()
	.regex(/^cfg:[a-zA-Z0-9_]{3,100}$/, { message: "Choose an app config key (cfg:KEY)" });

export const gitSettingsSchema = z.object({
	url: gitUrlSchema,
	branch: gitBranchSchema,
	path: gitPathSchema,
	username: cfgRefSchema,
	token: cfgRefSchema,
	encryptSecrets: z.boolean(),
});
export type GitSettings = z.infer<typeof gitSettingsSchema>;
