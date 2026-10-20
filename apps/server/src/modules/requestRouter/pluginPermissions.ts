import type { Context, ModuleBlockRun } from "@fluxify/blocks";
import { grantContext } from "@fluxify/sdk/runtime";
import type { PluginPermissions } from "../../db/schema";

export const NO_PERMISSIONS: PluginPermissions = { integrations: [], appconfig: false };

/**
 * A plugin block's `ctx` reaches only what its approval granted (#857):
 * integrations of the granted kinds (`database`, `kv`, `queue`) and app config
 * if granted. Anything else throws, naming the block and what it lacks. The
 * gate is the SDK's (`grantContext`), so the test harness denies the same way.
 *
 * A contract on `ctx`, not isolation: plugin code runs in the execution
 * process like a compiled graph, which is why a creator approves it at all.
 */
export function withGrantedContext(
	run: ModuleBlockRun,
	granted: PluginPermissions,
	label: string,
): ModuleBlockRun {
	return (args) => {
		// observability loggers are the runtime's, never a block's
		const ctx: Context = { ...args.ctx, integrationFactory: undefined };
		return run({ ...args, ctx: grantContext(ctx, granted, label) });
	};
}
