import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { memoryFs } from "./memoryFs";

/**
 * The git plumbing for backups to a repository (#1150): isomorphic-git over
 * fetch, on an in-memory file system, with no git binary and nothing on disk.
 * A commit fetches the branch tip only (depth 1), writes blobs, trees and the
 * commit straight into the object store (no checkout, no index) and pushes.
 */

/** where to fetch and push; without a token the fetch is anonymous (a public repository) */
export type GitRemote = { url: string; branch: string; username?: string; token?: string };
type Entry = { mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" };
export type Repo = { fs: ReturnType<typeof memoryFs>; tip: string | undefined };

const dir = "/repo";
const TREE = "040000";
const segments = (path: string) => path.split("/").filter(Boolean);
// a token alone is enough for GitHub, GitLab and Gitea, which ignore the username when given one
const auth = ({ username, token }: GitRemote) =>
	token ? () => ({ username: username || "git", password: token }) : undefined;

/** a fresh repository holding the branch's newest `depth` commits; `tip` is undefined when the branch has none */
export async function fetchBranch(remote: GitRemote, depth = 1): Promise<Repo> {
	const fs = memoryFs();
	await git.init({ fs, dir, defaultBranch: remote.branch });
	// fetch by url alone works on an empty repo but needs the remote's refspec once the branch has commits
	await git.addRemote({ fs, dir, remote: "origin", url: remote.url });
	const fetched = await git
		.fetch({
			fs,
			http,
			dir,
			url: remote.url,
			ref: remote.branch,
			singleBranch: true,
			depth,
			tags: false,
			onAuth: auth(remote),
		})
		.catch((error: { code?: string; data?: { what?: string } }) => {
			// a repository with commits, but not on this branch: it starts with the first commit
			if (error.code === "NotFoundError" && error.data?.what === remote.branch) return null;
			throw error;
		});
	return { fs, tip: fetched?.fetchHead ?? undefined };
}

const entries = async ({ fs }: Repo, oid?: string): Promise<Entry[]> =>
	oid ? (await git.readTree({ fs, dir, oid })).tree : [];

export const writeBlob = ({ fs }: Repo, blob: Uint8Array) => git.writeBlob({ fs, dir, blob });

/** a file of the branch tip, or undefined when there is none at that path */
export async function readTipFile(repo: Repo, filepath: string) {
	if (!repo.tip) return undefined;
	return git
		.readBlob({ fs: repo.fs, dir, oid: repo.tip, filepath })
		.catch((error: { code?: string }) => {
			if (error.code === "NotFoundError") return undefined;
			throw error;
		});
}

/** nested trees for blobs keyed by relative path; returns the top tree's entries */
async function folderEntries(repo: Repo, blobs: Map<string, string>): Promise<Entry[]> {
	const here: Entry[] = [];
	const below = new Map<string, Map<string, string>>();
	for (const [path, oid] of blobs) {
		const cut = path.indexOf("/");
		if (cut < 0) here.push({ mode: "100644", path, oid, type: "blob" });
		else {
			const name = path.slice(0, cut);
			if (!below.has(name)) below.set(name, new Map());
			below.get(name)!.set(path.slice(cut + 1), oid);
		}
	}
	for (const [name, files] of below) {
		const tree = await folderEntries(repo, files);
		here.push({ mode: TREE, path: name, oid: await writeTree(repo, tree), type: "tree" });
	}
	return here;
}

const writeTree = ({ fs }: Repo, tree: Entry[]) => git.writeTree({ fs, dir, tree });

/**
 * `root` with the folder at `path` holding `backup`: the backup's own names
 * there are replaced (README.md goes when the backup has none), everything
 * else in the folder and the repository stays.
 */
async function place(
	repo: Repo,
	root: string | undefined,
	path: string[],
	backup: Entry[],
): Promise<string> {
	const current = await entries(repo, root);
	if (!path.length) {
		const owned = new Set(["manifest.json", "README.md", "sections", "files"]);
		return writeTree(repo, [...current.filter((e) => !owned.has(e.path)), ...backup]);
	}
	const [name, ...rest] = path as [string, ...string[]];
	const child = current.find((e) => e.path === name && e.type === "tree");
	const oid = await place(repo, child?.oid, rest, backup);
	return writeTree(repo, [
		...current.filter((e) => e.path !== name),
		{ mode: TREE, path: name, oid, type: "tree" },
	]);
}

/** a commit on top of the tip whose folder `path` holds exactly `blobs` (relative path → blob id) */
export async function commitFolder(
	repo: Repo,
	input: {
		path: string;
		blobs: Map<string, string>;
		message: string;
		author: { name: string; email: string };
	},
) {
	const { fs, tip } = repo;
	const root = tip ? (await git.readCommit({ fs, dir, oid: tip })).commit.tree : undefined;
	const tree = await place(
		repo,
		root,
		segments(input.path),
		await folderEntries(repo, input.blobs),
	);
	const { message } = input;
	const author = { ...input.author, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
	return git.writeCommit({
		fs,
		dir,
		commit: { message, tree, parent: tip ? [tip] : [], author, committer: author },
	});
}

/** moves the remote branch to `oid`; a moved branch throws `PushRejectedError` */
export async function pushCommit(repo: Repo, remote: GitRemote, oid: string) {
	const { fs } = repo;
	await git.writeRef({ fs, dir, ref: `refs/heads/${remote.branch}`, value: oid, force: true });
	const result = await git.push({
		fs,
		http,
		dir,
		url: remote.url,
		ref: remote.branch,
		remoteRef: remote.branch,
		onAuth: auth(remote),
	});
	const refused = result.refs[`refs/heads/${remote.branch}`]?.error || result.error;
	if (!result.ok || refused)
		throw new Error(`The git server refused the push: ${refused || "no reason given"}`);
}

/** the newest commits a fetch of `depth` holds, newest first */
export async function commitsOf(repo: Repo, depth: number) {
	if (!repo.tip) return [];
	const log = await git.log({ fs: repo.fs, dir, ref: repo.tip, depth });
	return log.map(({ oid, commit }) => ({
		sha: oid,
		message: commit.message.trim(),
		author: commit.author.name,
		date: new Date(commit.author.timestamp * 1000).toISOString(),
	}));
}

/** every file under `path` in `commit`, relative to it; empty when the folder isn't there */
export async function readFolder(repo: Repo, commit: string, path: string) {
	const { fs } = repo;
	let oid: string | undefined = (await git.readCommit({ fs, dir, oid: commit })).commit.tree;
	for (const name of segments(path))
		oid = (await entries(repo, oid)).find((e) => e.path === name && e.type === "tree")?.oid;
	const files = new Map<string, Uint8Array>();
	const walk = async (tree: string | undefined, prefix: string) => {
		for (const e of await entries(repo, tree))
			if (e.type === "tree") await walk(e.oid, `${prefix}${e.path}/`);
			else if (e.type === "blob")
				files.set(`${prefix}${e.path}`, (await git.readBlob({ fs, dir, oid: e.oid })).blob);
	};
	await walk(oid, "");
	return files;
}
