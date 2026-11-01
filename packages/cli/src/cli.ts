import { runCli } from "./cli/citty";
import { root } from "./commands";

/** Runs a command line; returns the exit code. */
export const main = (argv: string[], cwd = process.cwd()) => runCli(root, "fluxify-cli", argv, cwd);
