/**
 * What a command is, in our own terms. Nothing here (or in the commands that
 * use it) knows which library parses the arguments: only `./citty.ts` does.
 */
export type ArgSpec =
	| { type: "positional"; description: string; required?: boolean }
	| {
			type: "string";
			description: string;
			/** one letter: `-n` */
			short?: string;
			/** shown in help: `--name=<hint>` */
			hint?: string;
			required?: boolean;
			default?: string;
	  }
	| {
			type: "boolean";
			description: string;
			short?: string;
			/** with `default: true` the flag is turned off with `--no-<name>` */
			default?: boolean;
	  };

export type ArgSpecs = Record<string, ArgSpec>;

type Value<A extends ArgSpec> = A extends { type: "boolean" }
	? boolean
	: A extends { type: "positional" }
		? A extends { required: false }
			? string | undefined
			: string
		: A extends { required: true } | { default: string }
			? string
			: string | undefined;

export type Args<A extends ArgSpecs> = { [K in keyof A]: Value<A[K]> };

export type CommandContext<A extends ArgSpecs> = { args: Args<A>; cwd: string };

export type CommandSpec<A extends ArgSpecs = ArgSpecs> = {
	description: string;
	/** root only: printed by a lone `--version` / `-v`, and shown in help */
	version?: string;
	args?: A;
	/** runs the command; a command with only `commands` is a group */
	run?: (ctx: CommandContext<A>) => Promise<void> | void;
	commands?: Record<string, CommandSpec<any>>;
};

/** identity, for inference: `args` types flow into `run` */
export const command = <const A extends ArgSpecs = {}>(spec: CommandSpec<A>) => spec;
