import { BadRequestError } from "../../errors/badRequestError";
import { NotFoundError } from "../../errors/notFoundError";
import { describeGitError } from "./gitDestination";
import { commitsOf, fetchBranch, type GitRemote, readFolder } from "./gitRepo";
import { openTree } from "./gitTree";
import { MAX_REMOTE_ARCHIVE_BYTES } from "./remote";

/**
 * Reading backups back from a git repository: the project's own (#1150), or
 * any URL typed in to create a project from (#1152). Only where the remote and
 * its credentials come from differs; nothing here stores them.
 */

/** commits a restore picker lists, and how deep a restore fetches to find one */
export const COMMIT_LIMIT = 50;

/** a git failure the user can fix as a 400; anything else as it is */
export async function withGitErrors<T>(remote: GitRemote, work: () => Promise<T>) {
	try {
		return await work();
	} catch (error) {
		const message = describeGitError(remote.url, error, Boolean(remote.token));
		throw message ? new BadRequestError(message) : error;
	}
}

/** the branch's newest commits, newest first; none for a branch with no commits */
export const listCommits = (remote: GitRemote) =>
	withGitErrors(remote, async () =>
		commitsOf(await fetchBranch(remote, COMMIT_LIMIT), COMMIT_LIMIT),
	);

const where = (path: string) => (path ? `the folder ${path}` : "the repository's root");

/**
 * The backup in the folder `path` of commit `sha`, opened for `inspectArchive`
 * / `restoreProject`. The commit must be among the branch's newest; the folder
 * is held to the same size cap as a backup downloaded from a bucket.
 */
export async function openCommit(remote: GitRemote, path: string, sha: string) {
	const files = await withGitErrors(remote, async () => {
		const repo = await fetchBranch(remote, COMMIT_LIMIT);
		const known = (await commitsOf(repo, COMMIT_LIMIT)).some((c) => c.sha === sha);
		if (!known)
			throw new NotFoundError(
				`That commit isn't among the newest ${COMMIT_LIMIT} on ${remote.branch}.`,
			);
		return readFolder(repo, sha, path);
	});
	if (!files.has("manifest.json"))
		throw new BadRequestError(`That commit holds no Fluxify backup in ${where(path)}.`);
	let size = 0;
	for (const bytes of files.values()) size += bytes.length;
	if (size > MAX_REMOTE_ARCHIVE_BYTES)
		throw new BadRequestError(
			`This backup is ${Math.ceil(size / 1024 / 1024)} MB; the largest that can be restored is ${MAX_REMOTE_ARCHIVE_BYTES / 1024 / 1024} MB.`,
		);
	return openTree(files);
}
