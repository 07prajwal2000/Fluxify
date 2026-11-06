import { logger } from "@fluxify/common";
import { sleep, type TriggerLagContext } from "@fluxify/sdk/triggers";

/**
 * Measures a plugin trigger's backlog for KEDA (#963). One loop per running
 * instance that defines `lag` and has a `lagPerWorker`, on a timer of its own so
 * KEDA's polls times the replicas never reach the author's source: the supervisor
 * only ever answers from the last number.
 *
 * A read that throws, hangs, or returns anything but a finite number of at
 * least 0 reports `null`, "unknown", which the endpoint turns into an error:
 * never a 0, which would shrink the claim. None of it counts against the
 * trigger's own failures, so a source that is slow to answer never turns it off.
 */

const TAG = "TRIGGERS.lag";

/** how often a worker reads the source, and how long one read may take; tests shorten them */
export const lagLimits = { everyMs: 15_000, timeoutMs: 5_000 };

/** the child's line to the supervisor, which holds the numbers; set by the execution process */
let report: (triggerId: string, lag: number | null) => void = () => undefined;
export function setLagReporter(next: typeof report) {
	report = next;
}

export type LagDefinition = { read(ctx: TriggerLagContext): Promise<number> };

/** instances whose last read failed: a source that stays down is logged once, not every round */
const failing = new Set<string>();

/** one read: the number, or null with the reason logged */
async function sample(
	triggerId: string,
	lag: LagDefinition,
	ctx: TriggerLagContext,
): Promise<number | null> {
	const expired = new AbortController();
	const signal = AbortSignal.any([ctx.signal, expired.signal]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const value = await Promise.race([
			lag.read({ ...ctx, signal }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					expired.abort();
					reject(new Error(`did not answer within ${lagLimits.timeoutMs / 1000}s`));
				}, lagLimits.timeoutMs);
			}),
		]);
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
			failing.delete(triggerId);
			return value;
		}
		throw new Error(`returned ${String(value)}, not a number of at least 0`);
	} catch (error) {
		if (!ctx.signal.aborted && !failing.has(triggerId)) {
			failing.add(triggerId);
			logger.warn(
				`[triggers] ${triggerId} lag.read ${error instanceof Error ? error.message : String(error)}`,
				TAG,
			);
		}
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Starts the loop; it ends, and withdraws its number, when `ctx.signal` aborts.
 * Never rejects: a loop that threw would be an unhandled rejection in the
 * process that runs every trigger.
 */
export function startLagSampler(triggerId: string, lag: LagDefinition, ctx: TriggerLagContext) {
	void (async () => {
		while (!ctx.signal.aborted) {
			const value = await sample(triggerId, lag, ctx);
			if (ctx.signal.aborted) break;
			report(triggerId, value);
			await sleep(lagLimits.everyMs, ctx.signal);
		}
		failing.delete(triggerId);
		report(triggerId, null);
	})().catch((error) => logger.error(`[triggers] ${triggerId} lag loop: ${String(error)}`, TAG));
}
