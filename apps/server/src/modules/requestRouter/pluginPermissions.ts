import {
	type Context,
	type IntegrationFound,
	type ModuleBlockRun,
	withCtxIntegrations,
} from "@fluxify/blocks";
import { grantContext } from "@fluxify/sdk/runtime";
import type { PluginPermissions } from "../../db/schema";
import { findIntegrationConfig, ownsIntegration } from "../../loaders/integrationsLoader";

export const NO_PERMISSIONS: PluginPermissions = { integrations: [], appconfig: false };

/**
 * The integration `id` names, when this project may use it. The caches hold the
 * environment's own config (a development worker has development values), and
 * answer a missing value by throwing the reason.
 */
export function integrationFor(projectId: string, id: string): IntegrationFound | undefined {
	const config = findIntegrationConfig(id);
	if (!ownsIntegration(config, projectId) || !config.group) return undefined;
	return { group: config.group, variant: config.variant, config };
}

/**
 * A plugin block's `ctx` reaches only what its approval granted (#857):
 * integrations of the granted kinds (`database`, `kv`, `queue`, or
 * `ctx.integrations.get` for any kind, `group` or `group/variant`) and app config
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
	return async (args) => {
		// observability loggers are the runtime's, never a block's
		const ctx: Context = { ...args.ctx, integrationFactory: undefined };
		const open = withCtxIntegrations(ctx, (id) => integrationFor(ctx.projectId, id));
		try {
			return await run({ ...args, ctx: grantContext(open.ctx, granted, label) });
		} finally {
			open.release();
		}
	};
}
