/**
 * The smallest file system isomorphic-git runs on, held in a Map, so a git
 * backup never touches the disk (#1150). Only the calls isomorphic-git makes
 * for fetch, object writes and push; no symlinks, no permissions.
 */

type Entry = Uint8Array | "dir";

const fail = (code: string, path: string) => Object.assign(new Error(`${code}: ${path}`), { code });

const norm = (path: string) => {
	const parts: string[] = [];
	for (const part of path.split("/"))
		if (part === "..") parts.pop();
		else if (part && part !== ".") parts.push(part);
	return `/${parts.join("/")}`;
};
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

const statOf = (entry: Entry) => {
	const dir = entry === "dir";
	return {
		type: dir ? "dir" : "file",
		mode: dir ? 0o40755 : 0o100644,
		size: dir ? 0 : entry.length,
		ino: 0,
		dev: 0,
		uid: 0,
		gid: 0,
		mtimeMs: 0,
		ctimeMs: 0,
		isFile: () => !dir,
		isDirectory: () => dir,
		isSymbolicLink: () => false,
	};
};

export function memoryFs() {
	const files = new Map<string, Entry>([["/", "dir"]]);
	const get = (path: string) => {
		const entry = files.get(norm(path));
		if (!entry) throw fail("ENOENT", path);
		return entry;
	};
	const needDir = (path: string) => {
		if (files.get(parentOf(norm(path))) !== "dir") throw fail("ENOENT", path);
	};
	const promises = {
		async readFile(path: string, options?: string | { encoding?: string }) {
			const entry = get(path);
			if (entry === "dir") throw fail("EISDIR", path);
			const encoding = typeof options === "string" ? options : options?.encoding;
			return encoding ? new TextDecoder().decode(entry) : entry;
		},
		async writeFile(path: string, data: Uint8Array | string) {
			needDir(path);
			if (files.get(norm(path)) === "dir") throw fail("EISDIR", path);
			files.set(norm(path), typeof data === "string" ? new TextEncoder().encode(data) : data);
		},
		async unlink(path: string) {
			if (get(path) === "dir") throw fail("EISDIR", path);
			files.delete(norm(path));
		},
		async readdir(path: string) {
			if (get(path) !== "dir") throw fail("ENOTDIR", path);
			const dir = norm(path);
			const prefix = dir === "/" ? "/" : `${dir}/`;
			return [...files.keys()]
				.filter((p) => p !== dir && p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
				.map((p) => p.slice(prefix.length));
		},
		async mkdir(path: string) {
			if (files.has(norm(path))) throw fail("EEXIST", path);
			needDir(path);
			files.set(norm(path), "dir");
		},
		async rmdir(path: string) {
			if (get(path) !== "dir") throw fail("ENOTDIR", path);
			if ((await promises.readdir(path)).length) throw fail("ENOTEMPTY", path);
			files.delete(norm(path));
		},
		stat: async (path: string) => statOf(get(path)),
		lstat: async (path: string) => statOf(get(path)),
		async readlink(path: string): Promise<string> {
			throw fail("EINVAL", path);
		},
		async symlink(_target: string, path: string) {
			throw fail("EPERM", path);
		},
		async chmod() {},
	};
	return { promises };
}
