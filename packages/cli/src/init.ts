import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Ask, initAnswers } from "./initAnswers";
import { fail } from "./plugin";
import {
	GITIGNORE,
	type PackageSpecs,
	packageJson,
	pluginIndex,
	readme,
	TSCONFIG,
} from "./templates";

export type InitOptions = {
	cwd: string;
	/** the plugin directory, created if missing; default `cwd` */
	dir?: string;
	/** `scope/name` */
	name?: string;
	/** where the docs and source live: https only */
	url?: string;
	/** default 0.1.0 */
	version?: string;
	/** default none */
	description?: string;
	/** never ask: take the default of what is not given */
	yes?: boolean;
	/** overwrite files, and take over a plain package.json */
	force?: boolean;
	/** `bun install` afterwards; default true */
	install?: boolean;
	/** asks for what is missing; absent when there is no terminal to ask on */
	ask?: Ask;
	/** dependency specs; default the SDK this CLI runs against */
	specs?: Partial<PackageSpecs>;
};

/** the SDK this CLI runs against: a plugin made now asks for at least this version */
async function currentSdk() {
	const file = join(dirname(Bun.resolveSync("@fluxify/sdk", import.meta.dir)), "package.json");
	const pkg = await Bun.file(file).json();
	return { version: pkg.version as string, zod: pkg.peerDependencies.zod as string };
}

/** Starts an empty plugin project: no blocks, `blocks create` adds the first. */
export async function init(options: InitOptions) {
	const root = resolve(options.cwd, options.dir ?? ".");
	const answers = await initAnswers(options);
	const { name } = answers;

	const pkgFile = join(root, "package.json");
	if (existsSync(pkgFile)) {
		const pkg = await Bun.file(pkgFile)
			.json()
			.catch(() => ({}));
		if (pkg.fluxify) return fail("already a Fluxify plugin");
		if (!options.force)
			return fail("package.json exists and is not a Fluxify plugin: use --force to replace it");
	}

	const sdk = await currentSdk();
	const files: Record<string, string> = {
		"package.json": packageJson(answers, {
			sdk: `>=${sdk.version}`,
			zod: sdk.zod,
			cli: `>=${sdk.version}`,
			typescript: "^5.9.2",
			bunTypes: "^1.4.0",
			...options.specs,
		}),
		"tsconfig.json": TSCONFIG,
		"src/index.ts": pluginIndex(answers),
		"src/blocks/.gitkeep": "",
		"icons/.gitkeep": "",
		"README.md": readme(answers),
		".gitignore": GITIGNORE,
	};
	const taken = Object.keys(files).filter((f) => f !== "package.json" && existsSync(join(root, f)));
	if (taken.length && !options.force)
		return fail(
			`${taken.join(", ")} already exist${taken.length === 1 ? "s" : ""}: use --force to overwrite`,
		);

	mkdirSync(root, { recursive: true });
	await Promise.all(Object.entries(files).map(([path, text]) => Bun.write(join(root, path), text)));

	let installed = false;
	if (options.install !== false) {
		const install = Bun.spawn([process.execPath, "install"], {
			cwd: root,
			stdout: "inherit",
			stderr: "inherit",
		});
		if (await install.exited) return fail("bun install failed");
		installed = true;
	}
	return { root, name, files: Object.keys(files), installed };
}
