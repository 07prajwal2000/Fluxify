import { createHash } from "node:crypto";
import { DEFAULT_IDLE_TIMEOUT_MS, LeasedResources, type ResourceLease } from "@fluxify/lib";
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

/** object keys sorted, so equal config in a different key order is the same client */
const sortKeys = (_name: string, value: unknown) =>
	value && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
		: value;

/** hashed, so a secret in the key is never retained or logged */
const fingerprint = (key: unknown) =>
	createHash("sha256")
		.update(JSON.stringify(key ?? null, sortKeys))
		.digest("hex");

/**
 * `ctx.pool` for a programmable block's `run`. Each call takes a lease that
 * `release()` drops when `run` settles, so a client never closes under a run.
 *
 * A call after `run` settled (a late `executeHandle` chain) holds its lease only
 * while `create` resolves: the run's lifetime is a bare flag with no end event,
 * so there is nothing to hold it to. A plugin must not keep using a pooled
 * client from a late call, and should call `ctx.pool` again each time.
 */
export function withCtxPool(ctx: Context, type: string) {
	const leases: ResourceLease<Promise<unknown>>[] = [];
	let settled = false;
	const pool: NonNullable<Context["pool"]> = async (kind, key, options) => {
		const slot = [ctx.projectId, type, kind, fingerprint(key)].join("\0");
		const lease = pooled.acquire(slot, "", {
			create: async () => options.create(key),
			destroy: async (client) => {
				let value: any;
				try {
					value = await client;
				} catch {
					return; // create failed, nothing to close
				}
				await options.destroy?.(value);
			},
			idleMs: options.idleMs,
		});
		const late = settled;
		if (!late) leases.push(lease);
		try {
			return (await lease.value) as any;
		} catch (error) {
			lease.discard(); // not cached: the next call retries
			throw error;
		} finally {
			if (late) lease.release();
		}
	};
	return {
		ctx: { ...ctx, pool },
		release() {
			settled = true;
			for (const lease of leases) lease.release();
		},
	};
}
