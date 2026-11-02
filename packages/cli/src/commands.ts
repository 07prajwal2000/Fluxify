import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import pkg from "../package.json" with { type: "json" };
import { build } from "./build";
import { command } from "./cli/spec";
import { create, createIntegration, createTrigger } from "./create";
import { init } from "./init";
import { CliError, findPluginRoot } from "./plugin";

/** asks on the terminal; undefined when stdin is not one */
function terminalAsk() {
	if (!process.stdin.isTTY) return undefined;
	return async (question: string) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			return await rl.question(`${question}: `);
		} finally {
			rl.close();
		}
	};
}

const wrote = (cwd: string, r: { root: string; files: string[]; manual?: string }) => {
	console.log(`wrote ${r.files.join(", ")} in ${relative(cwd, r.root) || "."}`);
	if (r.manual) console.warn(r.manual);
};

const initCommand = command({
	description:
		"A new, empty plugin in dir (default: here). With no options it asks for each setting",
	args: {
		dir: { type: "positional", required: false, description: "Folder to create the plugin in" },
		name: {
			type: "string",
			short: "n",
			hint: "scope/name",
			description: "Plugin name (asked for on a terminal)",
		},
		url: {
			type: "string",
			short: "u",
			hint: "https url",
			description: "Plugin URL (asked for on a terminal)",
		},
		version: {
			type: "string",
			short: "v",
			hint: "x.y.z",
			description: "Plugin version (default: 0.1.0)",
		},
		description: {
			type: "string",
			short: "d",
			description: "What the plugin is for (default: none)",
		},
		yes: {
			type: "boolean",
			short: "y",
			description: "Ask nothing: use the defaults for what is not given",
		},
		force: { type: "boolean", short: "f", description: "Write into a folder that is not empty" },
		install: { type: "boolean", default: true, description: "Run `bun install` afterwards" },
	},
	async run({ cwd, args }) {
		const result = await init({
			cwd,
			dir: args.dir,
			name: args.name,
			url: args.url,
			version: args.version,
			description: args.description,
			yes: args.yes,
			force: args.force,
			install: args.install,
			ask: terminalAsk(),
		});
		const where = relative(cwd, result.root);
		console.log(`created ${result.name} in ${where || "."}`);
		if (!result.installed) console.log("skipped bun install: run it before `build`");
		console.log("next:");
		if (where) console.log(`  cd ${where}`);
		console.log("  fluxify-cli blocks create <name>\n  bun run build");
	},
});

const blocksCreate = command({
	description: "Add src/blocks/<name>.ts to the current plugin",
	args: {
		name: { type: "positional", description: "Block name; folders allowed (messages/post)" },
	},
	async run({ cwd, args }) {
		wrote(cwd, await create({ cwd, name: args.name }));
	},
});

const buildCommand = command({
	description: "Build the plugin: dist/, fluxify.json and <scope>-<name>-<version>.tgz",
	async run({ cwd }) {
		const root = await findPluginRoot(cwd);
		if (!root) throw new CliError(["not a Fluxify plugin, run `fluxify-cli init` first"]);
		const { plugin, manifest, tarball, warnings } = await build(root);
		for (const w of warnings) console.warn(`warn  ${w}`);
		const count = Object.keys(manifest.blocks).length;
		const extra = [
			[manifest.integrations?.length, "integration(s)"],
			[manifest.triggers?.length, "trigger(s)"],
		].flatMap(([n, what]) => (n ? [`, ${n} ${what}`] : []));
		console.log(
			`built ${plugin.name}@${plugin.version}: ${count} block(s)${extra.join("")} -> ${tarball}`,
		);
	},
});

const integrationsCreate = command({
	description:
		"Add src/integrations/<name>.ts: a variant of a built-in group (database, kv, queue, ai, observability, baas, mcp) or of a group of the plugin's own",
	args: {
		name: { type: "positional", description: "Integration name" },
		group: { type: "string", short: "g", description: "Group it belongs to (default: <name>)" },
	},
	async run({ cwd, args }) {
		wrote(cwd, await createIntegration({ cwd, name: args.name, group: args.group }));
	},
});

const triggersCreate = command({
	description: "Add src/triggers/<name>.ts: a poll loop that hands what it finds to a workflow",
	args: { name: { type: "positional", description: "Trigger name" } },
	async run({ cwd, args }) {
		wrote(cwd, await createTrigger({ cwd, name: args.name }));
	},
});

export const root = command({
	version: pkg.version,
	description: "Create, build and pack Fluxify plugins",
	commands: {
		init: initCommand,
		build: buildCommand,
		blocks: {
			description: "Blocks of the current plugin",
			commands: { create: blocksCreate },
		},
		integrations: {
			description: "Integrations of the current plugin",
			commands: { create: integrationsCreate },
		},
		triggers: {
			description: "Triggers of the current plugin",
			commands: { create: triggersCreate },
		},
	},
});
