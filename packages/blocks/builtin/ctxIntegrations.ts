import { configOwner, integrationRegistry } from "@fluxify/adapters";
import { DEFAULT_IDLE_TIMEOUT_MS, LeasedResources } from "@fluxify/lib";
import { type IntegrationSource, leasePool } from "@fluxify/sdk/runtime";
import type { Context } from "../baseBlock";

/**
 * Clients of integrations no built-in factory owns (a plugin's own group, ai,
 * observability), one per variant and `poolKey`. Not `ctx.pool`'s store: that is
 * for a block's own resources.
 */
const pooled = new LeasedResources<Promise<unknown>>({ idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS });

/** closes every pooled client; the worker's graceful shutdown calls it next to `closeCtxPools` */
export const closeCtxIntegrations = () => pooled.close();

export const ctxIntegrationStats = () => pooled.getStats();

/** an integration as the worker holds it, resolved for its environment; undefined when this project cannot use the id */
export type IntegrationFound = { group: string; variant: string; config: any };

/**
 * `ctx.integrations` for a programmable block's `run`; `release()` drops its
 * leases when `run` settles. Databases, key-value stores and queues come from
 * the request's own factories, so a plugin block shares their pools and, inside
 * a database transaction, the transaction's connection (the factory hands the
 * same adapter back for the whole request). Every other group is pooled here by
 * the variant's `poolKey`.
 */
export function withCtxIntegrations(
	ctx: Context,
	find: (id: string) => IntegrationFound | undefined,
) {
	const { pool, release } = leasePool(pooled, []);
	const integrations: IntegrationSource = {
		kind(id) {
			const found = find(id);
			return found && { group: found.group, variant: found.variant };
		},
		async get(rawId) {
			const id = rawId!;
			const { group, variant, config } = find(id)!;
			// the gate (`grantContext`) has already run `kind`; a late call may no longer find it
			if (group === "database") return ctx.dbFactory!.getDbAdapter(id) as never;
			if (group === "kv") return ctx.kvFactory!.getKvAdapter(id) as never;
			if (group === "queue") return (await ctx.queueFactory!.getProducer(id)) as never;
			const def = integrationRegistry.require(group, variant, configOwner(config));
			if (!def.create) throw new Error(`${group} integration '${variant}' cannot be created`);
			return (await pool(`${group}/${variant}`, def.poolKey ? def.poolKey(config) : config, {
				create: () => def.create!(config, {} as never),
				destroy: (client) =>
					def.close ? def.close(client as never) : (client as any)?.disconnect?.(),
			})) as never;
		},
	};
	return { ctx: { ...ctx, integrations }, release };
}
