import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import type { z } from "zod";
import { fail } from "./plugin";
import { GITIGNORE, type PackageSpecs, packageJson, readme, TSCONFIG } from "./templates";

export type InitOptions = {
	cwd: string;
	/** the plugin directory, created if missing; default `cwd` */
	dir?: string;
	/** `scope/name` */
	name?: string;
	/** where the docs and source live: https only */
	url?: string;
	/** overwrite files, and take over a plain package.json */
	force?: boolean;
	/** `bun install` afterwards; default true */
	install?: boolean;
	/** asks for a missing flag; absent when there is no terminal to ask on */
	ask?: (question: string) => Promise<string>;
	/** dependency specs; default the SDK this CLI runs against */
	specs?: Partial<PackageSpecs>;
};

/** the SDK this CLI runs against: a plugin made now asks for at least this version */
async function currentSdk() {
	const file = join(dirname(Bun.resolveSync("@fluxify/sdk", import.meta.dir)), "package.json");
	const pkg = await Bun.file(file).json();
	return { version: pkg.version as string, zod: pkg.peerDependencies.zod as string };
}

/** a flag's value, asked for when missing and checked with the SDK's own rule */
async function flag(
	value: string | undefined,
	{ flag, question, schema }: { flag: string; question: string; schema: z.ZodType<string> },
	ask: InitOptions["ask"],
) {
	const given = value ?? (await ask?.(question))?.trim();
	if (!given) return fail(`${flag} is required: ${question}`);
	const parsed = schema.safeParse(given);
	return parsed.success
		? parsed.data
		: fail(`${flag} '${given}': ${parsed.error.issues[0].message}`);
}

/** Starts an empty plugin project: no blocks, `blocks create` adds the first. */
export async function init(options: InitOptions) {
	const root = resolve(options.cwd, options.dir ?? ".");
	const { shape } = fluxifyManifestSchema;
	const name = await flag(
		options.name,
		{ flag: "--name", question: "plugin name (scope/name, e.g. acme/slack)", schema: shape.name },
		options.ask,
	);
	const url = await flag(
		options.url,
		{ flag: "--url", question: "docs or source URL (https://...)", schema: shape.url },
		options.ask,
	);

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
		"package.json": packageJson(name, url, {
			sdk: `>=${sdk.version}`,
			zod: sdk.zod,
			cli: `>=${sdk.version}`,
			typescript: "^5.9.2",
			bunTypes: "^1.4.0",
			...options.specs,
		}),
		"tsconfig.json": TSCONFIG,
		"src/blocks/.gitkeep": "",
		"icons/.gitkeep": "",
		"README.md": readme(name, url),
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
