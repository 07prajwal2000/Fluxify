#!/usr/bin/env bun
/**
 * Copies real `.d.ts`/`.d.cts` files for the `libs.*` runtime packages (see
 * `packages/components/src/JavaScriptTextArea/globals.ts`) out of
 * node_modules into `public/types/<pkg>/`, where they're served as static
 * assets and fetched by `loadPackageTypes.ts` to feed Monaco autocomplete.
 *
 * To add a package: add an entry to `PACKAGES` below, run
 * `bun run sync-types`, and reference it with `typeof import("<pkg>")` in
 * globals.ts. Re-run after bumping the package's version.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface PackageSpec {
	/** Name Monaco resolves `import("...")` / `/// <reference types="..." />` against. */
	name: string;
	/** Directory containing the package's own node_modules layout. */
	sourceDir: string;
	/** File (relative to sourceDir) that `import "<pkg>"` should resolve to. */
	entry: string;
	/** Subdirectories (relative to sourceDir) to copy every declaration file from, in addition to `entry`. Pass "" for sourceDir's own root. */
	includeDirs?: string[];
	/** Declaration extensions to copy. Default both; narrow when a package ships parallel ESM/CJS trees (see zod). */
	extensions?: string[];
	/** Other PACKAGES entries this one's `/// <reference types="..." />` or relative imports need loaded first. */
	dependencies?: string[];
}

const PACKAGES: PackageSpec[] = [
	{
		name: "zod",
		sourceDir: "node_modules/zod",
		entry: "index.d.cts",
		// zod's root entry only re-exports from v4/classic → v4/core → v4/locales;
		// v3/, mini/, and the top-level locales/ are unrelated legacy/alt entry
		// points reached via other subpaths, so they're skipped.
		includeDirs: ["v4"],
		// zod ships parallel .d.ts (ESM) and .d.cts (CJS) trees; index.d.cts only
		// ever imports the .cjs siblings, so the .d.ts half is unreferenced.
		extensions: [".d.cts"],
	},
	{
		name: "underscore",
		sourceDir: "node_modules/@types/underscore",
		entry: "index.d.ts",
	},
	{
		// Registered as "bun" (not "bun-types", the real package name) because
		// that's the module specifier block code uses: `import { file } from "bun"`.
		name: "bun",
		sourceDir: "node_modules/bun-types",
		entry: "index.d.ts",
		// Flat package — every sibling `.d.ts` index.d.ts references, plus
		// vendor/expect-type which test.d.ts pulls in for `expectTypeOf`.
		includeDirs: [""],
		dependencies: ["@types/node"],
	},
	{
		// bun-types' index.d.ts starts with `/// <reference types="node" />`,
		// which TS resolves against `node_modules/@types/node` — the real
		// package name doubles as the required registration name here.
		name: "@types/node",
		sourceDir: "node_modules/@types/node",
		entry: "index.d.ts",
		includeDirs: [""],
		// @types/node's http/fetch/worker_threads types import the fetch/http
		// primitives from this separate package rather than declaring them
		// inline.
		dependencies: ["undici-types"],
	},
	{
		name: "undici-types",
		sourceDir: "node_modules/undici-types",
		entry: "index.d.ts",
		includeDirs: [""],
	},
];

const PORTAL_ROOT = join(import.meta.dir, "..");
const OUT_ROOT = join(PORTAL_ROOT, "public", "types");

/**
 * Relative paths become URL segments (fetched by the browser) and specifiers
 * inside `manifest.json`, so they're always joined with `/` regardless of
 * host OS — `node:path.join` would emit `\` on Windows. `dir: ""` means
 * `base` itself (a package's own root, not a subdirectory of it).
 */
async function findDeclarationFiles(
	dir: string,
	base: string,
	extensions: string[],
): Promise<string[]> {
	const entries = await readdir(join(base, dir), { withFileTypes: true });
	const results: string[] = [];
	for (const entry of entries) {
		const relPath = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			results.push(...(await findDeclarationFiles(relPath, base, extensions)));
		} else if (extensions.some((ext) => relPath.endsWith(ext))) {
			results.push(relPath);
		}
	}
	return results;
}

async function syncPackage(spec: PackageSpec): Promise<void> {
	const sourceDir = join(PORTAL_ROOT, spec.sourceDir);
	const outDir = join(OUT_ROOT, spec.name);

	const extensions = spec.extensions ?? [".d.ts", ".d.cts"];
	const relFiles = new Set<string>([spec.entry]);
	for (const dir of spec.includeDirs ?? []) {
		for (const file of await findDeclarationFiles(dir, sourceDir, extensions)) {
			relFiles.add(file);
		}
	}

	await mkdir(outDir, { recursive: true });

	for (const relPath of relFiles) {
		const content = await readFile(join(sourceDir, relPath), "utf8");
		const destPath = join(outDir, relPath);
		await mkdir(dirname(destPath), { recursive: true });
		await writeFile(destPath, content);
	}

	// A minimal, exports-map-free package.json: Monaco's simplified NodeJs
	// resolution needs a `types` field, but zod's real package.json exports
	// map assumes a full modern resolver Monaco's TS worker doesn't implement.
	relFiles.add("package.json");
	await writeFile(
		join(outDir, "package.json"),
		JSON.stringify({ name: spec.name, types: spec.entry }, null, 2),
	);

	await writeFile(
		join(outDir, "manifest.json"),
		JSON.stringify(
			{
				entry: spec.entry,
				files: [...relFiles].sort(),
				dependencies: spec.dependencies ?? [],
			},
			null,
			2,
		),
	);

	console.log(`[sync-type-libs] ${spec.name}: ${relFiles.size} files -> public/types/${spec.name}`);
}

for (const spec of PACKAGES) {
	await syncPackage(spec);
}
