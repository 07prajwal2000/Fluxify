import type { Context, ModuleBlockRun } from "@fluxify/blocks";
import type { PluginPermissions } from "../../db/schema";

export const NO_PERMISSIONS: PluginPermissions = { integrations: [], appconfig: false };

/** the ctx factories an integration kind opens, and the one call each answers */
const GATED = [
	["dbFactory", "getDbAdapter", "database"],
	["kvFactory", "getKvAdapter", "kv"],
	["queueFactory", "getProducer", "queue"],
] as const;

/**
 * A plugin block's `ctx` reaches only what its approval granted (#857):
 * integrations of the granted kinds (`database`, `kv`, `queue`) and app config
 * if granted. Anything else throws, naming the block and what it lacks.
 *
 * A contract on `ctx`, not isolation: plugin code runs in the execution
 * process like a compiled graph, which is why a creator approves it at all.
 */
export function withGrantedContext(
	run: ModuleBlockRun,
	granted: PluginPermissions,
	label: string,
): ModuleBlockRun {
	const deny = (what: string): never => {
		throw new Error(`${label} was not granted ${what}; approve a version that asks for it`);
	};
	return (args) => {
		const ctx: Context = {
			...args.ctx,
			// observability loggers are the runtime's, never a block's
			integrationFactory: undefined,
			vars: {
				...args.ctx.vars,
				getConfig: granted.appconfig ? args.ctx.vars.getConfig : () => deny("app config"),
			},
		};
		for (const [field, method, kind] of GATED) {
			if (!args.ctx[field] || granted.integrations.includes(kind)) continue;
			(ctx as any)[field] = { [method]: () => deny(`${kind} integrations`) };
		}
		return run({ ...args, ctx });
	};
}
