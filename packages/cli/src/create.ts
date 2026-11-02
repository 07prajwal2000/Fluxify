import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { manifestEntrySchema } from "@fluxify/sdk/blocks";
import { isBuiltInIntegrationGroup } from "@fluxify/sdk/integrations";
import { integrationTemplate, integrationTest, PLACEHOLDER_ICON } from "./integrationTemplates";
import { INDEX } from "./meta";
import { fail, findPluginRoot, readPlugin } from "./plugin";
import { exampleBlock, exampleTest } from "./templates";
import { triggerTemplate, triggerTest } from "./triggerTemplates";

type Created = { root: string; files: string[]; manual?: string };

/**
 * `src/index.ts` with `identifier` imported from `path` and added to the `list`
 * field of `plugin({...})`, or undefined when it has no `plugin({` to edit.
 */
export function addToIndex(text: string, list: string, identifier: string, path: string) {
	if (!text.includes("plugin({")) return undefined;
	const statement = `import ${identifier} from "${path}";\n`;
	const imports = [...text.matchAll(/^import\b[^;'"]*["'][^"']+["'][^\S\n]*;?[^\S\n]*\n?/gm)];
	const last = imports.at(-1);
	const at = last ? last.index + last[0].length : 0;
	const gap = last && !last[0].endsWith("\n") ? "\n" : "";
	const imported = `${text.slice(0, at)}${gap}${statement}${text.slice(at)}`;
	const open = new RegExp(`\\b${list}:\\s*\\[`).exec(imported);
	if (!open) return imported.replace("plugin({", `plugin({\n\t${list}: [${identifier}],`);
	const start = open.index + open[0].length;
	const end = imported.indexOf("]", start);
	const items = imported.slice(start, end);
	const body = items.trimEnd().replace(/,$/, "");
	let next = identifier;
	if (items.includes("\n")) {
		const indent = /\n([^\S\n]*)\S/.exec(items)?.[1] ?? "";
		next = `${body},\n${indent}${identifier},${items.slice(items.trimEnd().length)}`;
	} else if (body.trim()) next = `${body}, ${identifier}`;
	return imported.slice(0, start) + next + imported.slice(end);
}

/** a variable name for the import, one no JavaScript keyword can clash with: `send-mail` is `sendMailBlock` */
function identifierFor(name: string, suffix: string, text: string) {
	const words = basename(name)
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean);
	const camel = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
	const base = `${/^[0-9]/.test(camel) ? "_" : ""}${camel}${suffix}`;
	let identifier = base;
	for (let n = 2; new RegExp(`\\b${identifier}\\b`).test(text); n++) identifier = `${base}${n}`;
	return identifier;
}

/**
 * Adds `src/<dir>/<name>.ts` and its test to the plugin around `cwd`, lists it in
 * `src/index.ts`, plus a placeholder icon when `icon` is set. `check` refuses a bad option before
 * anything is written. Returns the files written.
 */
async function scaffold(o: {
	cwd: string;
	name: string;
	dir: "blocks" | "integrations" | "triggers";
	what: string;
	/** ends the name of the import in `src/index.ts` */
	suffix: string;
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
	const indexFile = join(root, INDEX);
	const text = await Bun.file(indexFile).text();
	const identifier = identifierFor(o.name, o.suffix, text);
	const path = `./${o.dir}/${o.name}`;
	const updated = addToIndex(text, o.dir, identifier, path);
	if (updated === undefined)
		return {
			root,
			files,
			manual: `Could not edit ${INDEX}. Add: import ${identifier} from "${path}"; and list ${identifier} in ${o.dir}`,
		};
	await Bun.write(indexFile, updated);
	return { root, files: [...files, INDEX] };
}

/** Adds `src/blocks/<name>.ts` and its test to the plugin around `cwd`. Returns the files written. */
export const create = (options: { cwd: string; name: string }) =>
	scaffold({
		...options,
		dir: "blocks",
		what: "a block",
		suffix: "Block",
		source: exampleBlock,
		test: exampleTest,
	});

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
		suffix: "Integration",
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
		suffix: "Trigger",
		source: triggerTemplate,
		test: triggerTest,
		icon: true,
	});
