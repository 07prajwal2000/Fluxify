import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { manifestEntrySchema } from "@fluxify/sdk/blocks";
import { isBuiltInIntegrationGroup } from "@fluxify/sdk/integrations";
import { integrationTemplate, integrationTest, PLACEHOLDER_ICON } from "./integrationTemplates";
import { fail, findPluginRoot, readPlugin } from "./plugin";
import { exampleBlock, exampleTest } from "./templates";
import { triggerTemplate, triggerTest } from "./triggerTemplates";

type Created = { root: string; files: string[] };

/**
 * Adds `src/<dir>/<name>.ts` and its test to the plugin around `cwd`, plus a
 * placeholder icon when `icon` is set. `check` refuses a bad option before
 * anything is written. Returns the files written.
 */
async function scaffold(o: {
	cwd: string;
	name: string;
	dir: "blocks" | "integrations" | "triggers";
	what: string;
	source(type: string): string;
	test(file: string): string;
	icon?: boolean;
	check?(): string | undefined;
}): Promise<Created> {
	const root = await findPluginRoot(o.cwd);
	if (!root) return fail("not a Fluxify plugin, run `fluxify-cli init` first");
	const { name: plugin } = await readPlugin(root, { lockfile: false });
	const type = `${plugin}/${o.name}`;
	const valid = manifestEntrySchema.shape.name.safeParse(type);
	if (!valid.success)
		return fail(`'${o.name}' is not ${o.what} name: ${valid.error.issues[0].message}`);
	const problem = o.check?.();
	if (problem) return fail(problem);

	const file = `src/${o.dir}/${o.name}.ts`;
	const test = `src/${o.dir}/${o.name}.test.ts`;
	const taken = [file, test].find((f) => existsSync(join(root, f)));
	if (taken) return fail(`${taken} already exists`);
	await Bun.write(join(root, file), o.source(type));
	await Bun.write(join(root, test), o.test(basename(o.name)));
	const files = [file, test];
	const icon = `icons/${basename(o.name)}.svg`;
	if (o.icon && !existsSync(join(root, icon))) {
		await Bun.write(join(root, icon), PLACEHOLDER_ICON);
		files.push(icon);
	}
	return { root, files };
}

/** Adds `src/blocks/<name>.ts` and its test to the plugin around `cwd`. Returns the files written. */
export const create = (options: { cwd: string; name: string }) =>
	scaffold({ ...options, dir: "blocks", what: "a block", source: exampleBlock, test: exampleTest });

/** a plugin's own group name */
const LOCAL_GROUP = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Adds `src/integrations/<name>.ts`, its test and a placeholder icon: a variant
 * of a built-in `group`, or of a group of the plugin's own (default `<name>`).
 */
export function createIntegration(options: { cwd: string; name: string; group?: string }) {
	const group = options.group ?? basename(options.name);
	return scaffold({
		...options,
		dir: "integrations",
		what: "an integration",
		source: (type) => integrationTemplate(type, group),
		test: integrationTest,
		icon: true,
		check: () =>
			isBuiltInIntegrationGroup(group) || LOCAL_GROUP.test(group)
				? undefined
				: `group '${group}' must be a built-in group or a lowercase name of your own`,
	});
}

/** Adds `src/triggers/<name>.ts`, its test and a placeholder icon: a poll loop to fill in. */
export const createTrigger = (options: { cwd: string; name: string }) =>
	scaffold({
		...options,
		dir: "triggers",
		what: "a trigger",
		source: triggerTemplate,
		test: triggerTest,
		icon: true,
	});
