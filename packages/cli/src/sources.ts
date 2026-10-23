import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { blockEntryPath, integrationEntryPath } from "@fluxify/sdk/blocks";
import { triggerEntryPath } from "@fluxify/sdk/triggers";
import { Glob } from "bun";
import { fail, type Plugin } from "./plugin";

/** what a plugin ships from one folder of `src`: blocks, integrations or triggers */
export type Kind = {
	dir: "blocks" | "integrations" | "triggers";
	/** where the built module of `type` sits */
	entry(type: string): string;
	/** whether a module's default export is one of these */
	is(def: any): boolean;
	what: string;
};

export const BLOCKS: Kind = {
	dir: "blocks",
	entry: blockEntryPath,
	is: (def) => typeof def?.run === "function" && typeof def.name === "string",
	what: "a block(...)",
};
export const INTEGRATIONS: Kind = {
	dir: "integrations",
	entry: integrationEntryPath,
	is: (def) => typeof def?.connect === "function" && typeof def.name === "string",
	what: "an integration(...)",
};
export const TRIGGERS: Kind = {
	dir: "triggers",
	entry: triggerEntryPath,
	is: (def) =>
		typeof def?.start === "function" &&
		typeof def.stop === "function" &&
		typeof def.name === "string",
	what: "a trigger(...)",
};

export type Source = { file: string; rel: string; type: string; kind: Kind };
export type Found = Source & { def: any };

export const posix = (path: string) => path.replaceAll("\\", "/");

/** every `src/<dir>/**\/*.ts`; its type is the plugin name plus its path */
export function discover(plugin: Plugin, kind: Kind): Source[] {
	const dir = join(plugin.root, "src", kind.dir);
	const files = existsSync(dir)
		? [...new Glob("**/*.ts").scanSync(dir)]
				.map(posix)
				.filter((f) => !/\.(d|test|spec)\.ts$/.test(f))
				.sort()
		: [];
	return files.map((f) => ({
		file: join(dir, f),
		rel: `src/${kind.dir}/${f}`,
		type: `${plugin.name}/${f.replace(/\.ts$/, "")}`,
		kind,
	}));
}

/** one module per block, integration and trigger under dist/, shared code in dist/chunks, npm packages left to the worker's install */
export async function bundle(plugin: Plugin, sources: Source[]) {
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
	for (const b of found) {
		const same = found.filter((o) => o.kind === b.kind && o.def.name === b.def.name);
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
