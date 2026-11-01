/**
 * The only file that imports citty. It turns a `CommandSpec` tree into citty
 * commands and runs them. Swapping the parser means rewriting this file.
 */
import { type ArgsDef, type CommandDef, defineCommand, renderUsage, runCommand } from "citty";
import { CliError } from "../fail";
import type { CommandSpec } from "./spec";

type Node = CommandDef<any>;

/** a command line the author got wrong: shown with the command's help */
class UsageError extends Error {}
/** citty throws its own `CLIError` (unexported) for unknown commands and missing arguments */
const isCittyUsage = (e: unknown): e is Error => e instanceof Error && e.name === "CLIError";

const HELP = new Set(["--help", "-h"]);
const VERSION = new Set(["--version", "-v"]);

function argsDef(spec: CommandSpec): ArgsDef {
	const out: Record<string, any> = {};
	for (const [name, a] of Object.entries(spec.args ?? {})) {
		out[name] =
			a.type === "positional"
				? { type: "positional", description: a.description, required: a.required ?? true }
				: {
						type: a.type,
						description: a.description,
						alias: a.short,
						valueHint: "hint" in a ? a.hint : undefined,
						required: "required" in a ? a.required : undefined,
						default: a.default,
					};
	}
	return out;
}

/** citty ignores flags it does not know: a typo like `--forse` must not pass silently */
function unknownFlags(spec: CommandSpec, rawArgs: string[]) {
	const known = new Set(["help", "h"]);
	for (const [name, a] of Object.entries(spec.args ?? {})) {
		if (a.type === "positional") continue;
		known.add(name);
		if (a.short) known.add(a.short);
		if (a.type === "boolean" && a.default) known.add(`no-${name}`);
	}
	const unknown: string[] = [];
	for (const token of rawArgs) {
		if (token === "--") break;
		const long = token.match(/^--([^=]+)/)?.[1];
		const shorts = long ? [] : (token.match(/^-([^-=][^=]*)/)?.[1] ?? "").split("");
		for (const flag of long ? [long] : shorts)
			if (!known.has(flag)) unknown.push(long ? `--${flag}` : `-${flag}`);
	}
	return unknown;
}

function toCitty(spec: CommandSpec, name: string, cwd: string): Node {
	const subs: Record<string, Node> = {};
	for (const [key, sub] of Object.entries(spec.commands ?? {}))
		subs[key] = toCitty(sub, `${name} ${key}`, cwd);
	return defineCommand({
		// the full path, so `blocks create --help` prints `fluxify-cli blocks create`
		meta: { name, description: spec.description, version: spec.version },
		args: argsDef(spec),
		subCommands: spec.commands ? subs : undefined,
		run: spec.run
			? async ({ args, rawArgs }) => {
					const bad = unknownFlags(spec, rawArgs);
					if (bad.length) throw new UsageError(`Unknown option ${bad.join(", ")}`);
					await spec.run!({ args: args as any, cwd });
				}
			: undefined,
	});
}

/** the command that `rawArgs` selects: the deepest subcommand named in order */
async function resolve(root: Node, rawArgs: string[]) {
	let cmd = root;
	for (const token of rawArgs) {
		if (token.startsWith("-")) continue;
		const sub = ((cmd.subCommands ?? {}) as Record<string, Node>)[token];
		if (!sub) break;
		cmd = sub;
	}
	return cmd;
}

/** Runs a command line; returns the exit code. */
export async function runCli(spec: CommandSpec, name: string, argv: string[], cwd: string) {
	const root = toCitty(spec, name, cwd);
	try {
		if (argv.some((a) => HELP.has(a))) {
			console.log(await renderUsage(await resolve(root, argv)));
			return 0;
		}
		// only on its own: `init -v 1.2.3` is the plugin's version
		if (spec.version && argv.length === 1 && VERSION.has(argv[0])) {
			console.log(spec.version);
			return 0;
		}
		await runCommand(root, { rawArgs: argv });
		return 0;
	} catch (error) {
		if (error instanceof CliError) for (const p of error.problems) console.error(`error  ${p}`);
		else if (error instanceof UsageError || isCittyUsage(error)) {
			console.error(await renderUsage(await resolve(root, argv)));
			console.error(`\nerror  ${error.message}`);
		} else console.error(`error  ${(error as Error).message}`);
		return 1;
	}
}
