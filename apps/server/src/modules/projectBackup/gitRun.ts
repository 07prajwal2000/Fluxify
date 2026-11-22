import { and, eq, inArray } from "drizzle-orm";
import { upsertProjectSettingKey } from "../../api/v1/projects/settings/keys/upsert/repository";
import { type DbTransactionType, db } from "../../db";
import { projectSettingsEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { EncryptionService } from "../../lib/encryption";
import { audit } from "../audit";
import { decodeAppConfig } from "../integrationOps/appConfig";
import { gitDestination } from "./gitDestination";
import type { GitRemote } from "./gitRepo";
import { GIT_KEYS, type GitSettings, MASKED } from "./gitSettings";
import { listCommits, openCommit } from "./gitSource";
import { hasRunning, insertBackup, lockProjectBackups } from "./history";
import { BACKUP_MODULES } from "./modules";
import { runBackup } from "./run";
import { readSchedule } from "./schedule";

/**
 * Commits to a git repository (#1150, open source, manual only): the settings,
 * "Commit to git", the branch's commits, and a commit opened for a restore.
 */

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
		email: get(GIT_KEYS.email),
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The commits' author and committer: the configured username and email
 * (#1153), never the Fluxify user, since a host links a commit to whichever
 * profile has that email. Who clicked Commit stays on the row (`createdBy`).
 */
async function authorOf(projectId: string, settings: GitSettings, name: string) {
	if (!settings.email) throw new BadRequestError("Add an email in the git settings.");
	const email = await credential(projectId, settings.email);
	if (!EMAIL.test(email))
		throw new BadRequestError(
			`The git email "${email}" doesn't look like an email address. Fix it in the git settings.`,
		);
	return { name, email };
}

/**
 * "Commit to git": a backup of every section, with version history and app
 * config values, committed as one commit with `message`. Runs on this admin
 * after the response; the row (`type: "git"`) keeps the SHA and the message.
 */
export async function startGitCommit(projectId: string, userId: string | null, message: string) {
	const { settings, remote } = await gitRemote(projectId);
	// before the row: a bad email refuses the commit instead of failing it
	const author = await authorOf(projectId, settings, remote.username ?? "");
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
		author,
	});
	const options = { includeVersionHistory: true, includeAppConfigValues: true };
	return { id: row.id, done: runBackup(row, { options, readme }, destination) };
}

/** the branch's newest commits, newest first; none for a branch that doesn't exist yet */
export async function listGitCommits(projectId: string) {
	return listCommits((await gitRemote(projectId)).remote);
}

/** the backup in commit `sha`, opened for `inspectArchive` / `restoreProject` */
export async function openGitCommit(projectId: string, sha: string) {
	const { settings, remote } = await gitRemote(projectId);
	return openCommit(remote, settings.path, sha);
}
