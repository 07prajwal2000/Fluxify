import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { GENERAL_TAB } from "@fluxify/sdk";
import {
	blockEntryPath,
	type FluxifyManifest,
	fluxifyManifestSchema,
	ICON_URL_MAX,
	type ManifestEntry,
	manifestEntrySchema,
	toManifestEntry,
} from "@fluxify/sdk/blocks";
import { Glob } from "bun";
import { z } from "zod";
import { lintDocs } from "./lint/docs";
import { findUnawaited } from "./lint/unawaited";
import { pack } from "./pack";
import { fail, type Plugin, readPlugin } from "./plugin";

type Source = { file: string; rel: string; type: string };
type Found = Source & { def: any };

export type BuildResult = {
	plugin: Plugin;
	manifest: FluxifyManifest;
	tarball: string;
	warnings: string[];
};

const prettify = (error: z.ZodError) => z.prettifyError(error).replaceAll("\n", " ");
const posix = (path: string) => path.replaceAll("\\", "/");

/** every `src/blocks/**\/*.ts`; the block's type is the plugin name plus its path */
async function discover(plugin: Plugin): Promise<Source[]> {
	const dir = join(plugin.root, "src", "blocks");
	const files = existsSync(dir)
		? [...new Glob("**/*.ts").scanSync(dir)]
				.map(posix)
				.filter((f) => !/\.(d|test|spec)\.ts$/.test(f))
				.sort()
		: [];
	if (!files.length)
		fail("no blocks in src/blocks, add one with `fluxify-cli blocks create <name>`");
	return files.map((f) => ({
		file: join(dir, f),
		rel: `src/blocks/${f}`,
		type: `${plugin.name}/${f.replace(/\.ts$/, "")}`,
	}));
}

/** one module per block under dist/blocks, shared code in dist/chunks, npm packages left to the worker's install */
async function bundle(plugin: Plugin, sources: Source[]) {
	rmSync(join(plugin.root, "dist"), { recursive: true, force: true });
	const result = await Bun.build({
		entrypoints: sources.map((s) => s.file),
		root: join(plugin.root, "src"),
		outdir: join(plugin.root, "dist"),
		naming: { entry: "[dir]/[name].[ext]", chunk: "chunks/[name]-[hash].[ext]" },
		target: "bun",
		format: "esm",
		splitting: true,
		external: plugin.external.flatMap((name) => [name, `${name}/*`]),
	}).catch((error: unknown) => ({
		success: false,
		logs: (error as AggregateError).errors ?? [error],
	}));
	if (!result.success)
		fail(...result.logs.map((log: { message?: string }) => `bundle failed: ${log.message ?? log}`));
	for (const s of sources)
		if (!existsSync(join(plugin.root, blockEntryPath(s.type))))
			fail(`${s.rel}: the bundler did not write ${blockEntryPath(s.type)}`);
}

/** Imports each built entry (on the author's machine, never the admin) for its definition. */
async function load(plugin: Plugin, sources: Source[]): Promise<Found[]> {
	const problems: string[] = [];
	const found: Found[] = [];
	const stamp = Date.now();
	for (const s of sources) {
		const url = `${pathToFileURL(join(plugin.root, blockEntryPath(s.type))).href}?t=${stamp}`;
		try {
			const def = (await import(url)).default;
			if (typeof def?.run === "function" && typeof def.name === "string") found.push({ ...s, def });
			else problems.push(`${s.rel}: must default-export a block(...)`);
		} catch (error) {
			problems.push(`${s.rel}: ${(error as Error).message}`);
		}
	}
	for (const b of found) {
		const same = found.filter((o) => o.def.name === b.def.name);
		if (same.length > 1 && same[0] === b)
			problems.push(
				`${same.map((o) => o.rel).join(" and ")} both declare the type '${b.def.name}'`,
			);
	}
	for (const b of found)
		if (b.def.name !== b.type)
			problems.push(
				`${b.rel}: name '${b.def.name}' must be '${b.type}' (the plugin name plus the path)`,
			);
	if (problems.length) fail(...problems);
	return found;
}

const MIME: Record<string, string> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

/**
 * Checks a block's icon against the custom block limit and makes sure it ships
 * in `icons/`. Returns the path the manifest holds.
 */
function shipIcon(plugin: Plugin, type: string, icon: string): string {
	const source = join(plugin.root, icon);
	const inside = relative(plugin.root, source);
	if (isAbsolute(icon) || inside.startsWith(".."))
		fail(`${type}: icon '${icon}' is outside the plugin`);
	const mime = MIME[extname(source).toLowerCase()];
	if (!mime) fail(`${type}: icon '${icon}' must be ${Object.keys(MIME).join(", ")}`);
	if (!existsSync(source)) fail(`${type}: icon '${icon}' does not exist`);
	// the portal stores a custom icon as a base64 data URL
	const length = `data:${mime};base64,`.length + Math.ceil(statSync(source).size / 3) * 4;
	if (length > ICON_URL_MAX)
		fail(
			`${type}: icon '${icon}' is ${length} characters as a data URL; the limit is ${ICON_URL_MAX}`,
		);
	const shipped = posix(inside).startsWith("icons/") ? posix(inside) : `icons/${basename(source)}`;
	if (shipped !== posix(inside)) {
		const dest = join(plugin.root, shipped);
		if (existsSync(dest) && !readFileSync(source).equals(readFileSync(dest)))
			fail(`${type}: icon '${icon}' would replace a different icons/${basename(source)}`);
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(source, dest);
	}
	return shipped;
}

/** the params (and hints) in a tab an explicit `tabs` leaves out: appended, but likely a typo */
const strayTabs = (def: { tabs?: string[]; params?: Record<string, { tab?: string }> }) =>
	def.tabs
		? Object.entries(def.params ?? {})
				.filter(
					([, p]) => p.tab !== undefined && p.tab !== GENERAL_TAB && !def.tabs!.includes(p.tab),
				)
				.map(([name]) => name)
		: [];

/** Warnings: the build still succeeds. */
async function lint(found: Found[], entries: Record<string, ManifestEntry>) {
	const warnings: string[] = [];
	for (const b of found) {
		const { docs } = entries[b.type];
		if (!docs?.trim()) warnings.push(`${b.type}: no docs. The Docs tab will be empty`);
		else for (const issue of lintDocs(docs)) warnings.push(`${b.type}: docs ${issue}`);
		for (const name of strayTabs(b.def))
			warnings.push(
				`${b.type}: param '${name}' is in a tab that tabs does not list, so it is shown after them`,
			);
		for (const line of findUnawaited(b.file, await Bun.file(b.file).text()))
			warnings.push(
				`${b.rel}:${line}: executeHandle(...) is not awaited. Await it, or its result and errors are lost`,
			);
	}
	return warnings;
}

/** Builds the plugin at `root`: dist/, fluxify.json and the tarball. Throws a CliError on a failure. */
export async function build(root: string): Promise<BuildResult> {
	const plugin = await readPlugin(root);
	const sources = await discover(plugin);
	await bundle(plugin, sources);
	const found = await load(plugin, sources);

	const problems: string[] = [];
	const entries: Record<string, ManifestEntry> = {};
	for (const b of found) {
		const entry = toManifestEntry(b.def);
		const parsed = manifestEntrySchema.safeParse(entry);
		if (parsed.success) entries[b.type] = parsed.data;
		else problems.push(`${b.rel}: ${prettify(parsed.error)}`);
	}
	if (problems.length) fail(...problems);
	for (const [type, entry] of Object.entries(entries))
		if (entry.icon) entry.icon = shipIcon(plugin, type, entry.icon);
	const { meta } = plugin;

	// generated every build from src/index.ts and the blocks: a hand edit does not survive it
	const manifest = fluxifyManifestSchema.safeParse({
		...meta,
		icon: meta.icon && shipIcon(plugin, meta.name, meta.icon),
		scopeIcon: meta.scopeIcon && shipIcon(plugin, `${meta.name} scope`, meta.scopeIcon),
		sdk: plugin.sdk,
		blocks: Object.fromEntries(
			Object.entries(entries).map(([type, e]) => [type, { entry: blockEntryPath(type), ...e }]),
		),
	});
	if (!manifest.success) fail(`fluxify.json is invalid: ${prettify(manifest.error)}`);
	await Bun.write(join(root, "fluxify.json"), `${JSON.stringify(manifest.data, null, 2)}\n`);

	const warnings = await lint(found, entries);
	const tarball = await pack(plugin, manifest.data!);
	return { plugin, manifest: manifest.data!, tarball, warnings };
}
