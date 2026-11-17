import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
	type FluxifyManifest,
	fluxifyManifestSchema,
	type PluginDependency,
} from "@fluxify/sdk/blocks";
import { Glob } from "bun";
import { z } from "zod";
import { fail, type Plugin } from "./plugin";
import { posix } from "./sources";

/**
 * Plugins this plugin depends on (#899): the npm peerDependencies whose package
 * ships a `fluxify.json`. Their groups are used for types only; the client a
 * block gets always comes from the project's integrations, so the bundle never
 * imports them.
 */
export type Dependencies = { list: PluginDependency[]; manifests: FluxifyManifest[] };

/** the installed package's folder: `node_modules/<name>` here or in a folder above, as Node resolves it */
function packageDir(root: string, name: string) {
	for (let dir = root; ; dir = dirname(dir)) {
		const at = join(dir, "node_modules", name);
		if (existsSync(join(at, "package.json"))) return at;
		if (dirname(dir) === dir) return undefined;
	}
}

/** each peer that is a Fluxify plugin, with its manifest; fails on a peer it cannot read */
export async function readDependencies(plugin: Plugin): Promise<Dependencies> {
	const deps: Dependencies = { list: [], manifests: [] };
	const problems: string[] = [];
	for (const [name, range] of Object.entries(plugin.peers)) {
		const dir = packageDir(plugin.root, name);
		if (!dir) {
			problems.push(
				`peerDependency ${name} is not installed: add it to devDependencies too and run bun install, so the build can read it`,
			);
			continue;
		}
		const file = join(dir, "fluxify.json");
		if (!existsSync(file)) {
			const pkg = await Bun.file(join(dir, "package.json")).json();
			if (pkg.fluxify)
				problems.push(`peerDependency ${name} is a Fluxify plugin with no fluxify.json: build it`);
			continue;
		}
		const parsed = fluxifyManifestSchema.safeParse(
			await Bun.file(file)
				.json()
				.catch(() => null),
		);
		if (!parsed.success) {
			problems.push(
				`peerDependency ${name} has an invalid fluxify.json: ${z.prettifyError(parsed.error).replaceAll("\n", " ")}`,
			);
			continue;
		}
		deps.list.push({ name, plugin: parsed.data.name, range });
		deps.manifests.push(parsed.data);
	}
	if (problems.length) fail(...problems);
	return deps;
}

/**
 * A dependency imported at run time: refused. Its client comes from the
 * project's integrations, and the worker installs no copy of it beside the
 * plugin. Read from the built modules, where `import type` is already gone.
 */
export async function runtimeImports(plugin: Plugin, deps: Dependencies) {
	if (!deps.list.length) return;
	const names = deps.list.map((d) => d.name);
	const imports = (path: string) => names.find((n) => path === n || path.startsWith(`${n}/`));
	const transpiler = new Bun.Transpiler({ loader: "js" });
	const problems: string[] = [];
	const dist = join(plugin.root, "dist");
	for (const file of new Glob("**/*.js").scanSync(dist)) {
		const code = await Bun.file(join(dist, file)).text();
		for (const { path } of transpiler.scanImports(code)) {
			const name = imports(path);
			if (name)
				problems.push(
					`${posix(relative(plugin.root, join(dist, file)))} imports ${name} at run time. A plugin dependency is for types only: write \`import type\`, and get its client from ctx.integrations`,
				);
		}
	}
	if (problems.length) fail(...problems);
}
