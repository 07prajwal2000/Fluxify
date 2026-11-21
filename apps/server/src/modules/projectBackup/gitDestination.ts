import { EncryptionService } from "../../lib/encryption";
import {
	commitFolder,
	fetchBranch,
	type GitRemote,
	pushCommit,
	type Repo,
	readTipFile,
	writeBlob,
} from "./gitRepo";
import { backupFiles } from "./gitTree";
import type { BackupDestination, FinishedArchive } from "./run";

/**
 * Backups committed to a git repository (#1150). Each run fetches the branch
 * tip, writes the backup as the files of one folder, and pushes one commit;
 * if the branch moved meanwhile, it fetches again and retries once. The key
 * the history keeps is the commit's SHA.
 */

export type GitTarget = GitRemote & {
	path: string;
	encryptSecrets: boolean;
	message: string;
	author: { name: string; email: string };
};

const join = (path: string, file: string) => (path ? `${path}/${file}` : file);

/** what a sealed file decrypts to here, or undefined (another key, or damaged) */
const opened = (sealed: Uint8Array) => {
	try {
		return EncryptionService.decryptBytes(sealed);
	} catch {
		return undefined;
	}
};

/**
 * Every file as a blob. Sealing is randomised, so a sealed file whose
 * plaintext is unchanged keeps the tip's blob, or it would show in every diff.
 */
async function writeBlobs(repo: Repo, archive: FinishedArchive, target: GitTarget) {
	const blobs = new Map<string, string>();
	for (const [file, content] of backupFiles(archive, target.encryptSecrets)) {
		if ("bytes" in content) {
			blobs.set(file, await writeBlob(repo, content.bytes));
			continue;
		}
		const before = await readTipFile(repo, join(target.path, file));
		const same =
			before && Buffer.from(content.seal).equals(opened(before.blob) ?? new Uint8Array());
		blobs.set(
			file,
			same ? before.oid : await writeBlob(repo, EncryptionService.encryptBytes(content.seal)),
		);
	}
	return blobs;
}

/** a failure as the person setting it up has to fix it; undefined for anything else */
export function describeGitError(url: string, error: unknown) {
	const e = error as { code?: string; caller?: string; data?: { statusCode?: number } };
	const status = e?.data?.statusCode;
	if (e?.code === "HttpError" && (status === 401 || status === 403))
		return `The git server refused the username or token (HTTP ${status}). Check the app config values they point to, and that the token may push to the repository.`;
	if (e?.code === "HttpError" && status === 404)
		return `There is no repository at ${url} (HTTP 404), or the token can't see it.`;
	if (e?.code === "HttpError") return `The git server at ${url} answered HTTP ${status}.`;
	if (e?.code === "PushRejectedError")
		return "The branch kept changing while the commit was pushed. Try again.";
	if (e?.code === "SmartHttpError" || e?.code === "ParseError")
		return `${url} doesn't answer like a git repository. Check the URL.`;
	// isomorphic-git tags whatever its fetch or push threw, its own errors or the network's
	if (error instanceof Error && e.caller && !e.code?.endsWith("Error"))
		return `Could not reach the git server at ${url}: ${error.message}`;
	return undefined;
}

export function gitDestination(target: GitTarget): BackupDestination {
	return {
		async save(archive) {
			for (let attempt = 0; ; attempt++) {
				const repo = await fetchBranch(target);
				const blobs = await writeBlobs(repo, archive, target);
				const oid = await commitFolder(repo, { ...target, blobs });
				try {
					await pushCommit(repo, target, oid);
					return oid;
				} catch (error) {
					const moved = (error as { code?: string }).code === "PushRejectedError";
					if (!moved || attempt > 0) throw error;
				}
			}
		},
		// a pushed commit can't be taken back; the branch keeps it, the row says the run failed
		async discard() {},
		explain: (error) => describeGitError(target.url, error),
	};
}
