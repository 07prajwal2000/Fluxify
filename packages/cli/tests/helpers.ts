import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "../src/build";
import { CliError } from "../src/plugin";

/** where `@fluxify/sdk`, `zod` and `oxc-parser` resolve from, so a test plugin needs no install */
export const NODE_MODULES = join(import.meta.dir, "..", "node_modules");

/** the smallest lockfile `bun pm pack` accepts */
export const LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "x",
    },
  },
  "packages": {
  }
}
`;

const made: string[] = [];
export const tmp = (prefix = "fx-cli-") => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	made.push(dir);
	return dir;
};
export const cleanup = () => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
};

/** link the shared node_modules into a directory */
export const linkModules = (dir: string) =>
	symlinkSync(NODE_MODULES, join(dir, "node_modules"), "junction");

export type BlockOptions = {
	/** markdown, or null for no docs */
	docs?: string | null;
	/** the body of `run({ params, executeHandle })` */
	body?: string;
	/** a line of code above the block */
	before?: string;
	/** extra fields of the definition */
	extra?: string;
};

/** a block with one body handle, `tools`, for `executeHandle` */
export const blockSrc = (
	type: string,
	{ docs = "Docs.", body = "return { output: 1 };", before = "", extra = "" }: BlockOptions = {},
) => `import { block, handle } from "@fluxify/sdk/blocks";
${before}
export default block({
	name: "${type}",
	label: "Test",
	${docs === null ? "" : `docs: ${JSON.stringify(docs)},`}
	handles: { body: [handle.body("tools", "top-left")] },
	${extra}
	async run({ params, executeHandle }) {
		${body}
	},
});
`;

/**
 * A plugin `acme/t` in a temp dir: one good block, a lockfile and the shared
 * node_modules. `files` add to or replace those (null removes one); `pkg`
 * merges into package.json.
 */
export async function makePlugin(
	files: Record<string, string | null> = {},
	pkg: Record<string, unknown> = {},
) {
	const root = tmp();
	const all: Record<string, string | null> = {
		"package.json": JSON.stringify({
			name: "@acme/t",
			version: "1.2.3",
			type: "module",
			fluxify: { name: "acme/t", url: "https://example.com/acme/t" },
			files: ["dist", "icons", "fluxify.json"],
			peerDependencies: { "@fluxify/sdk": ">=2026.10.2001", zod: "^4.0.0" },
			...pkg,
		}),
		"bun.lock": LOCK,
		"src/blocks/hello.ts": blockSrc("acme/t/hello"),
		...files,
	};
	for (const [path, text] of Object.entries(all)) {
		if (text === null) continue;
		mkdirSync(dirname(join(root, path)), { recursive: true });
		await Bun.write(join(root, path), text);
	}
	linkModules(root);
	return root;
}

/** the problems a failing build reports; throws if it succeeds */
export async function failures(root: string) {
	try {
		await build(root);
	} catch (error) {
		if (error instanceof CliError) return error.problems;
		throw error;
	}
	throw new Error("the build was expected to fail");
}
