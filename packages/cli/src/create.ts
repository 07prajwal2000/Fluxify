import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { manifestEntrySchema } from "@fluxify/sdk/blocks";
import { isBuiltInIntegrationGroup } from "@fluxify/sdk/integrations";
import { integrationTemplate, integrationTest, PLACEHOLDER_ICON } from "./integrationTemplates";
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

/** a plugin's own group name */
const LOCAL_GROUP = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Adds `src/integrations/<name>.ts`, its test and a placeholder icon: a variant
 * of a built-in `group`, or of a group of the plugin's own (default `<name>`).
 */
export async function createIntegration(options: {
	cwd: string;
	name: string;
	group?: string;
}): Promise<{ root: string; files: string[] }> {
	const root = await findPluginRoot(options.cwd);
	if (!root) return fail("not a Fluxify plugin, run `fluxify-cli init` first");
	const { name: plugin } = await readPlugin(root, { lockfile: false });
	const type = `${plugin}/${options.name}`;
	const valid = manifestEntrySchema.shape.name.safeParse(type);
	if (!valid.success)
		return fail(`'${options.name}' is not an integration name: ${valid.error.issues[0].message}`);
	const group = options.group ?? basename(options.name);
	if (!isBuiltInIntegrationGroup(group) && !LOCAL_GROUP.test(group))
		return fail(`group '${group}' must be a built-in group or a lowercase name of your own`);

	const icon = `icons/${basename(options.name)}.svg`;
	const file = `src/integrations/${options.name}.ts`;
	const test = `src/integrations/${options.name}.test.ts`;
	const taken = [file, test].find((f) => existsSync(join(root, f)));
	if (taken) return fail(`${taken} already exists`);
	await Bun.write(join(root, file), integrationTemplate(type, group));
	await Bun.write(join(root, test), integrationTest(basename(options.name)));
	const files = [file, test];
	if (!existsSync(join(root, icon))) {
		await Bun.write(join(root, icon), PLACEHOLDER_ICON);
		files.push(icon);
	}
	return { root, files };
}
