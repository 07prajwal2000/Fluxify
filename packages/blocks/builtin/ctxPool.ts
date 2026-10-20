import { DEFAULT_IDLE_TIMEOUT_MS, LeasedResources } from "@fluxify/lib";
import { leasePool } from "@fluxify/sdk/runtime";
import type { Context } from "../baseBlock";

/**
 * Every client a programmable block pools in this worker. The slot is project +
 * block type + kind + fingerprint of the key, so two projects never share a
 * client and a changed integration value is a new client.
 * ponytail: the old client of a changed value is not swapped out, it idles out
 * after its `idleMs`; with `idleMs: 0` it lives until shutdown.
 */
const pooled = new LeasedResources<Promise<unknown>>({ idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS });

/** closes every pooled client; the worker's graceful shutdown calls it next to the DB manager's */
export const closeCtxPools = () => pooled.close();

export const ctxPoolStats = () => pooled.getStats();

/**
 * `ctx.pool` for a programmable block's `run`; `release()` drops its leases when
 * `run` settles. The lease rules are the SDK's (`leasePool`), shared with the
 * test harness: a plugin must not keep using a pooled client from a late call,
 * and should call `ctx.pool` again each time.
 */
export function withCtxPool(ctx: Context, type: string) {
	const { pool, release } = leasePool(pooled, [ctx.projectId, type]);
	return { ctx: { ...ctx, pool }, release };
}
