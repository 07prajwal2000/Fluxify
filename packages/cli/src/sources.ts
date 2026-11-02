import { existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { blockEntryPath, integrationEntryPath, manifestEntrySchema } from "@fluxify/sdk/blocks";
import { triggerEntryPath } from "@fluxify/sdk/triggers";
import { Glob } from "bun";
import { INDEX } from "./meta";
import { fail, type Plugin } from "./plugin";

/** what a plugin ships from one folder of `src`: blocks, integrations or triggers */
export type Kind = {
	dir: "blocks" | "integrations" | "triggers";
	/** where the built module of `type` sits */
	entry(type: string): string;
	/** whether a module's default export is one of these */
	is(def: any): boolean;
	what: string;
	/** the SDK function that defines one */
	factory: string;
};

export const BLOCKS: Kind = {
	dir: "blocks",
	entry: blockEntryPath,
	is: (def) => typeof def?.run === "function" && typeof def.name === "string",
	what: "a block(...)",
	factory: "block",
};
export const INTEGRATIONS: Kind = {
	dir: "integrations",
	entry: integrationEntryPath,
	is: (def) => typeof def?.connect === "function" && typeof def.name === "string",
	what: "an integration(...)",
	factory: "integration",
};
export const TRIGGERS: Kind = {
	dir: "triggers",
	entry: triggerEntryPath,
	is: (def) => typeof def?.start === "function" && typeof def.name === "string",
	what: "a trigger(...)",
	factory: "trigger",
};

export type Source = { file: string; rel: string; type: string; kind: Kind };
export type Found = Source & { def: any };

export const posix = (path: string) => path.replaceAll("\\", "/");

/** each relative import of `src/index.ts`, by its default export: how a listed definition finds its file */
async function importedFiles(plugin: Plugin) {
	const index = join(plugin.root, INDEX);
	const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(await Bun.file(index).text());
	const files = new Map<unknown, string>();
	for (const { path } of imports) {
		if (!path.startsWith(".")) continue;
		const file = Bun.resolveSync(path, dirname(index));
		files.set((await import(file)).default, file);
	}
	return files;
}

/** what `src/index.ts` lists, each with its file; its type is its declared `name` */
export async function listedSources(plugin: Plugin): Promise<Source[]> {
	const files = await importedFiles(plugin);
	const root = realpathSync(plugin.root);
	const problems: string[] = [];
	const sources: Source[] = [];
	const check = (kind: Kind, def: any, i: number) => {
		const at = `${INDEX}: ${kind.dir}[${i}]`;
		if (!kind.is(def)) return `${at} must be ${kind.what}`;
		const file = files.get(def);
		if (!file)
			return `${at} ('${def.name}') must be the default import of its own file, like: import x from "./${kind.dir}/x"`;
		const rel = posix(relative(root, realpathSync(file)));
		const valid = manifestEntrySchema.shape.name.safeParse(def.name);
		if (!valid.success || !def.name.startsWith(`${plugin.name}/`))
			return `${rel}: name '${def.name}' must be '${plugin.name}/<name>': lowercase letters, digits, -, _ and /`;
		sources.push({ file, rel, type: def.name, kind });
	};
	for (const kind of [BLOCKS, INTEGRATIONS, TRIGGERS])
		for (const [i, def] of plugin.listed[kind.dir].entries()) {
			const problem = check(kind, def, i);
			if (problem) problems.push(problem);
		}
	for (const s of sources) {
		const same = sources.filter((o) => o.kind === s.kind && o.type === s.type);
		if (same.length > 1 && same[0] === s)
			problems.push(`${same.map((o) => o.rel).join(" and ")} both declare the type '${s.type}'`);
	}
	if (problems.length) fail(...problems);
	return sources;
}

/** the resource files in `src/<dir>` that `sources` leave out. Only read, never run: one may be half-written */
export async function unlistedFiles(plugin: Plugin, sources: Source[]) {
	const shipped = new Set(sources.map((s) => s.rel));
	const unlisted: { rel: string; kind: Kind }[] = [];
	for (const kind of [BLOCKS, INTEGRATIONS, TRIGGERS]) {
		const dir = join(plugin.root, "src", kind.dir);
		if (!existsSync(dir)) continue;
		// a helper a resource imports never calls the factory, so it is not reported
		const defines = new RegExp(`\\b${kind.factory}\\s*\\(`);
		for (const f of [...new Glob("**/*.ts").scanSync(dir)].map(posix).sort()) {
			const rel = `src/${kind.dir}/${f}`;
			if (/\.(d|test|spec)\.ts$/.test(f) || shipped.has(rel)) continue;
			if (defines.test(await Bun.file(join(dir, f)).text())) unlisted.push({ rel, kind });
		}
	}
	return unlisted;
}

/** one module per block, integration and trigger under dist/, shared code in dist/chunks, npm packages left to the worker's install */
export async function bundle(plugin: Plugin, sources: Source[]) {
	rmSync(join(plugin.root, "dist"), { recursive: true, force: true });
	// the bundler names output after its entry's path, and a module's place follows its `name`,
	// so each entry is a one-line re-export at that place, wherever the real file lives
	const stubs = join(plugin.root, ".fluxify-entries");
	rmSync(stubs, { recursive: true, force: true });
	const entrypoints = await Promise.all(
		sources.map(async (s) => {
			const stub = join(
				stubs,
				s.kind
					.entry(s.type)
					.replace(/^dist\//, "")
					.replace(/\.js$/, ".ts"),
			);
			await Bun.write(stub, `export { default } from ${JSON.stringify(posix(s.file))};\n`);
			return stub;
		}),
	);
	const result = await Bun.build({
		entrypoints,
		root: stubs,
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
	rmSync(stubs, { recursive: true, force: true });
	if (!result.success)
		fail(...result.logs.map((log: { message?: string }) => `bundle failed: ${log.message ?? log}`));
	for (const s of sources)
		if (!existsSync(join(plugin.root, s.kind.entry(s.type))))
			fail(`${s.rel}: the bundler did not write ${s.kind.entry(s.type)}`);
}

/** Imports each built entry (on the author's machine, never the admin) for its definition. */
export async function load(plugin: Plugin, sources: Source[]): Promise<Found[]> {
	const problems: string[] = [];
	const found: Found[] = [];
	const stamp = Date.now();
	for (const s of sources) {
		const url = `${pathToFileURL(join(plugin.root, s.kind.entry(s.type))).href}?t=${stamp}`;
		try {
			const def = (await import(url)).default;
			if (s.kind.is(def)) found.push({ ...s, def });
			else problems.push(`${s.rel}: must default-export ${s.kind.what}`);
		} catch (error) {
			problems.push(`${s.rel}: ${(error as Error).message}`);
		}
	}
	if (problems.length) fail(...problems);
	return found;
}
