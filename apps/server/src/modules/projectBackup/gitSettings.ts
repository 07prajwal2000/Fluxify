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
	email: "settings.backup.git.email",
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
/**
 * A username or token: an app config reference (`cfg:KEY`, read when committing)
 * or the value itself. A token typed in is stored encrypted and never sent back
 * (`MASKED` stands for it); neither is ever put in a backup.
 */
export const credentialSchema = z.string().trim().min(1).max(2000);
export const MASKED = "********";

export const gitSettingsSchema = z.object({
	url: gitUrlSchema,
	branch: gitBranchSchema,
	path: gitPathSchema,
	username: credentialSchema,
	/** the commits' author email, with `username` as the name: typed or `cfg:KEY`, not secret */
	email: credentialSchema,
	token: credentialSchema,
	encryptSecrets: z.boolean(),
});
export type GitSettings = z.infer<typeof gitSettingsSchema>;
