import { and, eq, inArray } from "drizzle-orm";
import { upsertProjectSettingKey } from "../../api/v1/projects/settings/keys/upsert/repository";
import { type DbTransactionType, db } from "../../db";
import { systemUsers } from "../../db/auth-schema";
import { projectSettingsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { NotFoundError } from "../../errors/notFoundError";
import { EncryptionService } from "../../lib/encryption";
import { audit } from "../audit";
import { decodeAppConfig } from "../integrationOps/appConfig";
import { describeGitError, gitDestination } from "./gitDestination";
import { commitsOf, fetchBranch, type GitRemote, readFolder } from "./gitRepo";
import { GIT_KEYS, type GitSettings, MASKED } from "./gitSettings";
import { openTree } from "./gitTree";
import { hasRunning, insertBackup, lockProjectBackups } from "./history";
import { BACKUP_MODULES } from "./modules";
import { runBackup } from "./run";
import { readSchedule } from "./schedule";

/**
 * Commits to a git repository (#1150, open source, manual only): the settings,
 * "Commit to git", the branch's commits, and a commit opened for a restore.
 */

/** commits a restore picker lists, and how deep a restore fetches to find one */
export const COMMIT_LIMIT = 50;

export async function readGitSettings(
	projectId: string,
	tx: DbTransactionType | typeof db = db,
): Promise<GitSettings> {
	const rows = await tx
		.select({ key: projectSettingsEntity.key, value: projectSettingsEntity.value })
		.from(projectSettingsEntity)
		.where(
			and(
				eq(projectSettingsEntity.projectId, projectId),
				inArray(projectSettingsEntity.key, Object.values(GIT_KEYS)),
			),
		);
	const get = (key: string) => rows.find((r) => r.key === key)?.value ?? "";
	return {
		url: get(GIT_KEYS.url),
		branch: get(GIT_KEYS.branch) || "main",
		path: get(GIT_KEYS.path),
		username: get(GIT_KEYS.username),
		token: get(GIT_KEYS.token),
		encryptSecrets: get(GIT_KEYS.encryptSecrets) !== "false",
	};
}

const SEALED_TOKEN = "enc:";
const refuse = (message: string): never => {
	throw new BadRequestError(message);
};

/**
 * Writes every key. A typed token is stored encrypted, as `enc:<…>`; `MASKED`
 * (what `GET` showed for it) keeps the stored one.
 */
export async function writeGitSettings(projectId: string, s: GitSettings, tx: DbTransactionType) {
	const before = await readGitSettings(projectId, tx);
	const token =
		s.token === MASKED
			? before.token || refuse("Type the token again: none is saved.")
			: s.token.startsWith("cfg:")
				? s.token
				: SEALED_TOKEN + EncryptionService.encrypt(s.token);
	const values = { ...s, token };
	for (const [field, key] of Object.entries(GIT_KEYS))
		await upsertProjectSettingKey(projectId, key, String(values[field as keyof GitSettings]), tx);
}

/** the settings as the portal sees them: a typed token is never sent back */
export async function gitSettingsView(projectId: string) {
	const settings = await readGitSettings(projectId);
	return { ...settings, token: settings.token.startsWith(SEALED_TOKEN) ? MASKED : settings.token };
}

/** a stored username or token: read from app config, decrypted, or as typed */
async function credential(projectId: string, stored: string) {
	if (stored.startsWith(SEALED_TOKEN))
		return EncryptionService.decrypt(stored.slice(SEALED_TOKEN.length));
	if (!stored.startsWith("cfg:")) return stored;
	const key = stored.slice(4);
	const value = (await decodeAppConfig([key], projectId, "production")).get(key);
	if (!value)
		throw new BadRequestError(
			`The app config key ${key} has no value. Set it, or choose another key for the git username or token.`,
		);
	return value;
}

/** the saved remote, with its username and token resolved now */
export async function gitRemote(projectId: string) {
	const settings = await readGitSettings(projectId);
	if (!settings.url)
		throw new BadRequestError("Set up the git repository in Project Settings > Backup first.");
	const remote: GitRemote = {
		url: settings.url,
		branch: settings.branch,
		username: await credential(projectId, settings.username),
		token: await credential(projectId, settings.token),
	};
	return { settings, remote };
}

/** a git failure the user can fix as a 400; anything else as it is */
async function git<T>(url: string, work: () => Promise<T>) {
	try {
		return await work();
	} catch (error) {
		const message = describeGitError(url, error);
		throw message ? new BadRequestError(message) : error;
	}
}

const authorOf = async (userId: string | null) => {
	const [user] = userId
		? await db
				.select({ name: systemUsers.name, email: systemUsers.email })
				.from(systemUsers)
				.where(eq(systemUsers.id, userId))
		: [];
	return { name: user?.name || "Fluxify", email: user?.email || "backups@fluxify.invalid" };
};

/**
 * "Commit to git": a backup of every section, with version history and app
 * config values, committed as one commit with `message`. Runs on this admin
 * after the response; the row (`type: "git"`) keeps the SHA and the message.
 */
export async function startGitCommit(projectId: string, userId: string | null, message: string) {
	const { settings, remote } = await gitRemote(projectId);
	const row = await db.transaction(async (tx) => {
		await lockProjectBackups(tx, projectId);
		if (await hasRunning(projectId, tx))
			throw new ConflictError(
				"A backup of this project is already running. Wait for it to finish.",
			);
		const created = await insertBackup(
			{
				projectId,
				type: "git",
				mode: "backup",
				sections: BACKUP_MODULES.map((m) => m.name),
				createdBy: userId,
				label: message,
			},
			tx,
		);
		await audit.record({
			projectId,
			resourceType: "project_backup",
			resourceId: created.id,
			action: "create",
			changedFields: ["type", "label"],
		});
		return created;
	});
	const { readme } = await readSchedule(projectId);
	const destination = gitDestination({
		...remote,
		path: settings.path,
		encryptSecrets: settings.encryptSecrets,
		message,
		author: await authorOf(userId),
	});
	const options = { includeVersionHistory: true, includeAppConfigValues: true };
	return { id: row.id, done: runBackup(row, { options, readme }, destination) };
}

/** the branch's newest commits, newest first; none for a branch that doesn't exist yet */
export async function listGitCommits(projectId: string) {
	const { remote } = await gitRemote(projectId);
	return git(remote.url, async () =>
		commitsOf(await fetchBranch(remote, COMMIT_LIMIT), COMMIT_LIMIT),
	);
}

/** the backup in commit `sha`, opened for `inspectArchive` / `restoreProject` */
export async function openGitCommit(projectId: string, sha: string) {
	const { settings, remote } = await gitRemote(projectId);
	const files = await git(remote.url, async () => {
		const repo = await fetchBranch(remote, COMMIT_LIMIT);
		const known = (await commitsOf(repo, COMMIT_LIMIT)).some((c) => c.sha === sha);
		if (!known)
			throw new NotFoundError(
				`That commit isn't among the newest ${COMMIT_LIMIT} on ${settings.branch}.`,
			);
		return readFolder(repo, sha, settings.path);
	});
	if (!files.has("manifest.json"))
		throw new BadRequestError(
			`That commit holds no backup in ${settings.path ? `the folder ${settings.path}` : "the repository's root"}.`,
		);
	return openTree(files);
}
