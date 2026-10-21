import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { build } from "./build";
import { create, createIntegration } from "./create";
import { init } from "./init";
import { CliError, findPluginRoot } from "./plugin";

const USAGE = `usage:
  fluxify-cli init [dir] [--name <scope/name>] [--url <https url>] [--force] [--no-install]
      a new, empty plugin in dir (default: here); --name and --url are asked for on a terminal
  fluxify-cli blocks create <name>
      add src/blocks/<name>.ts to the current plugin
  fluxify-cli integrations create <name> [--group <group>]
      add src/integrations/<name>.ts: a variant of a built-in group (database, kv, queue,
      ai, observability, baas, mcp) or of a group of the plugin's own (default: <name>)
  fluxify-cli blocks build
      dist/, fluxify.json and <scope>-<name>-<version>.tgz`;

function usage(code: number) {
	(code ? console.error : console.log)(USAGE);
	return code;
}

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

async function runInit(cwd: string, dir: string | undefined, values: Record<string, any>) {
	const result = await init({
		cwd,
		dir,
		name: values.name,
		url: values.url,
		force: values.force,
		install: !values["no-install"],
		ask: terminalAsk(),
	});
	const where = relative(cwd, result.root);
	console.log(`created ${result.name} in ${where || "."}`);
	if (!result.installed) console.log("skipped bun install: run it before `build`");
	console.log("next:");
	if (where) console.log(`  cd ${where}`);
	console.log("  fluxify-cli blocks create <name>\n  bun run build");
}

/** Runs a command line; returns the exit code. */
export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: argv,
			allowPositionals: true,
			options: {
				name: { type: "string" },
				url: { type: "string" },
				group: { type: "string" },
				force: { type: "boolean" },
				"no-install": { type: "boolean" },
				help: { type: "boolean", short: "h" },
			},
		});
		const [group, command, name] = positionals;
		if (values.help) return usage(0);

		if (group === "init" && positionals.length <= 2) {
			await runInit(cwd, command, values);
			return 0;
		}
		const creating = command === "create" && name && positionals.length === 3;
		if (group === "integrations" && creating) {
			const { root, files } = await createIntegration({ cwd, name, group: values.group });
			console.log(`wrote ${files.join(", ")} in ${relative(cwd, root) || "."}`);
			return 0;
		}
		if (group !== "blocks") return usage(1);
		if (creating) {
			const { root, files } = await create({ cwd, name });
			console.log(`wrote ${files.join(", ")} in ${relative(cwd, root) || "."}`);
			return 0;
		}
		if (command === "build" && !name) {
			const root = await findPluginRoot(cwd);
			if (!root) throw new CliError(["not a Fluxify plugin, run `fluxify-cli init` first"]);
			const { plugin, manifest, tarball, warnings } = await build(root);
			for (const w of warnings) console.warn(`warn  ${w}`);
			const count = Object.keys(manifest.blocks).length;
			const integrations = manifest.integrations?.length;
			console.log(
				`built ${plugin.name}@${plugin.version}: ${count} block(s)${integrations ? `, ${integrations} integration(s)` : ""} -> ${tarball}`,
			);
			return 0;
		}
		return usage(1);
	} catch (error) {
		if (error instanceof CliError) for (const p of error.problems) console.error(`error  ${p}`);
		else console.error(`error  ${(error as Error).message}`);
		return 1;
	}
}
