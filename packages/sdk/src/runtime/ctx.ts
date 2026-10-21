import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { PoolOptions } from "../context.js";
import type { LeasedResources, ResourceLease } from "./leasedResources.js";

/** one finished `ctx.span`; `parent` is the id of the span it was opened inside */
export type SpanRecord = {
	id: string;
	name: string;
	parent?: string;
	output: unknown;
	startedAt: number;
	endedAt: number;
	outcome: "success" | "failure";
	error?: unknown;
};

/** the innermost running `ctx.span`, so a span opened inside `fn` nests under it */
const current = new AsyncLocalStorage<string>();

/**
 * `ctx.span`: runs `fn` and records it, with outcome and error from whether it
 * threw (rethrown). With no `record` it only runs `fn`.
 */
export function createSpan(record?: (span: SpanRecord) => void) {
	return async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
		if (!record) return fn();
		const id = crypto.randomUUID();
		const parent = current.getStore();
		const startedAt = performance.now();
		const done = (output: unknown, error?: unknown) => {
			try {
				record({
					id,
					name,
					...(parent ? { parent } : {}),
					output,
					startedAt,
					endedAt: performance.now(),
					outcome: error === undefined ? "success" : "failure",
					...(error === undefined ? {} : { error }),
				});
			} catch {
				// Telemetry must never change execution.
			}
		};
		try {
			const output = await current.run(id, fn);
			done(output);
			return output;
		} catch (error) {
			done(undefined, error ?? new Error("thrown undefined"));
			throw error;
		}
	};
}

/** object keys sorted, so equal config in a different key order is the same client */
const sortKeys = (_name: string, value: unknown) =>
	value && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
		: value;

/** hashed, so a secret in the key is never retained or logged */
export const fingerprint = (key: unknown) =>
	createHash("sha256")
		.update(JSON.stringify(key ?? null, sortKeys))
		.digest("hex");

/**
 * `ctx.pool` for one `run`, over the shared `pooled` clients. The slot is
 * `scope` + kind + fingerprint of the key, so a changed value is a new client.
 * Each call takes a lease that `release()` drops when `run` settles, so a
 * client never closes under a run.
 *
 * A call after `run` settled (a late `executeHandle` chain) holds its lease only
 * while `create` resolves: the run's lifetime is a bare flag with no end event,
 * so there is nothing to hold it to.
 */
export function leasePool(pooled: LeasedResources<Promise<unknown>>, scope: string[]) {
	const leases: ResourceLease<Promise<unknown>>[] = [];
	let settled = false;
	const pool = async <T>(kind: string, key: unknown, options: PoolOptions<T>): Promise<T> => {
		const slot = [...scope, kind, fingerprint(key)].join("\0");
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
			return (await lease.value) as T;
		} catch (error) {
			lease.discard(); // not cached: the next call retries
			throw error;
		} finally {
			if (late) lease.release();
		}
	};
	return {
		pool,
		release() {
			settled = true;
			for (const lease of leases) lease.release();
		},
	};
}
