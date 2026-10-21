import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { GENERAL_TAB } from "@fluxify/sdk";
import {
	blockEntryPath,
	type FluxifyManifest,
	fluxifyManifestSchema,
	ICON_URL_MAX,
	type IntegrationEntry,
	integrationEntryPath,
	integrationEntrySchema,
	type ManifestEntry,
	manifestEntrySchema,
	toIntegrationEntry,
	toManifestEntry,
} from "@fluxify/sdk/blocks";
import { z } from "zod";
import { lintDocs } from "./lint/docs";
import { findUnawaited } from "./lint/unawaited";
import { pack } from "./pack";
import { fail, type Plugin, readPlugin } from "./plugin";
import { BLOCKS, bundle, discover, type Found, INTEGRATIONS, load, posix } from "./sources";

export type BuildResult = {
	plugin: Plugin;
	manifest: FluxifyManifest;
	tarball: string;
	warnings: string[];
};

const prettify = (error: z.ZodError) => z.prettifyError(error).replaceAll("\n", " ");

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
async function lint(
	blocks: Found[],
	entries: Record<string, ManifestEntry>,
	integrations: Found[],
) {
	const warnings: string[] = [];
	const stray = (type: string, def: Parameters<typeof strayTabs>[0]) => {
		for (const name of strayTabs(def))
			warnings.push(
				`${type}: param '${name}' is in a tab that tabs does not list, so it is shown after them`,
			);
	};
	for (const b of blocks) {
		const { docs } = entries[b.type];
		if (!docs?.trim()) warnings.push(`${b.type}: no docs. The Docs tab will be empty`);
		else for (const issue of lintDocs(docs)) warnings.push(`${b.type}: docs ${issue}`);
		stray(b.type, b.def);
		for (const line of findUnawaited(b.file, await Bun.file(b.file).text()))
			warnings.push(
				`${b.rel}:${line}: executeHandle(...) is not awaited. Await it, or its result and errors are lost`,
			);
	}
	for (const i of integrations) stray(i.type, { tabs: i.def.tabs, params: i.def.config });
	return warnings;
}

/** each found definition as its manifest entry, or a problem naming its file */
function entriesOf<E>(found: Found[], toEntry: (def: any) => unknown, schema: z.ZodType<E>) {
	const problems: string[] = [];
	const entries: Record<string, E> = {};
	for (const f of found) {
		const parsed = schema.safeParse(toEntry(f.def));
		if (parsed.success) entries[f.type] = parsed.data;
		else problems.push(`${f.rel}: ${prettify(parsed.error)}`);
	}
	return { problems, entries };
}

/** Builds the plugin at `root`: dist/, fluxify.json and the tarball. Throws a CliError on a failure. */
export async function build(root: string): Promise<BuildResult> {
	const plugin = await readPlugin(root);
	const sources = [...discover(plugin, BLOCKS), ...discover(plugin, INTEGRATIONS)];
	if (!sources.length)
		fail("no blocks in src/blocks, add one with `fluxify-cli blocks create <name>`");
	await bundle(plugin, sources);
	const found = await load(plugin, sources);
	const blocks = found.filter((f) => f.kind === BLOCKS);
	const integrated = found.filter((f) => f.kind === INTEGRATIONS);

	const b = entriesOf(blocks, toManifestEntry, manifestEntrySchema);
	const i = entriesOf<IntegrationEntry>(integrated, toIntegrationEntry, integrationEntrySchema);
	if (b.problems.length || i.problems.length) fail(...b.problems, ...i.problems);
	const entries = b.entries;
	for (const [type, entry] of [...Object.entries(entries), ...Object.entries(i.entries)])
		if (entry.icon) entry.icon = shipIcon(plugin, type, entry.icon);
	const { meta } = plugin;
	const integrations = Object.entries(i.entries).map(([type, e]) => ({
		entry: integrationEntryPath(type),
		...e,
	}));

	// generated every build from src/index.ts, the blocks and the integrations: a hand edit does not survive it
	const manifest = fluxifyManifestSchema.safeParse({
		...meta,
		icon: meta.icon && shipIcon(plugin, meta.name, meta.icon),
		scopeIcon: meta.scopeIcon && shipIcon(plugin, `${meta.name} scope`, meta.scopeIcon),
		sdk: plugin.sdk,
		blocks: Object.fromEntries(
			Object.entries(entries).map(([type, e]) => [type, { entry: blockEntryPath(type), ...e }]),
		),
		...(integrations.length && { integrations }),
	});
	if (!manifest.success) fail(`fluxify.json is invalid: ${prettify(manifest.error)}`);
	await Bun.write(
		join(root, "fluxify.json"),
		`${JSON.stringify(manifest.data, null, 2)}
`,
	);

	const warnings = await lint(blocks, entries, integrated);
	const tarball = await pack(plugin, manifest.data!);
	return { plugin, manifest: manifest.data!, tarball, warnings };
}
