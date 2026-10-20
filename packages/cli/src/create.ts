import { existsSync } from "node:fs";
import { join } from "node:path";
import { manifestEntrySchema } from "@fluxify/sdk/blocks";
import { fail, findPluginRoot, readPlugin } from "./plugin";
import { exampleBlock } from "./templates";

/** Adds `src/blocks/<name>.ts` to the plugin around `cwd`. Returns the file written. */
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
	if (existsSync(join(root, file))) return fail(`${file} already exists`);
	await Bun.write(join(root, file), exampleBlock(type));
	return { root, files: [file] };
}
