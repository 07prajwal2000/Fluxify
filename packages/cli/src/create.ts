import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { manifestEntrySchema } from "@fluxify/sdk/blocks";
import { fail, findPluginRoot, readPlugin } from "./plugin";
import { exampleBlock, exampleTest } from "./templates";

/** Adds `src/blocks/<name>.ts` and its test to the plugin around `cwd`. Returns the files written. */
export async function create(options: {
	cwd: string;
	name: string;
}): Promise<{ root: string; files: string[] }> {
	const root = await findPluginRoot(options.cwd);
	if (!root) return fail("not a Fluxify plugin, run `fluxify-cli init` first");
	const { name: plugin } = await readPlugin(root, { lockfile: false });

	const type = `${plugin}/${options.name}`;
	const valid = manifestEntrySchema.shape.name.safeParse(type);
	if (!valid.success)
		return fail(`'${options.name}' is not a block name: ${valid.error.issues[0].message}`);

	const file = `src/blocks/${options.name}.ts`;
	const test = `src/blocks/${options.name}.test.ts`;
	const taken = [file, test].find((f) => existsSync(join(root, f)));
	if (taken) return fail(`${taken} already exists`);
	await Bun.write(join(root, file), exampleBlock(type));
	await Bun.write(join(root, test), exampleTest(basename(options.name)));
	return { root, files: [file, test] };
}
