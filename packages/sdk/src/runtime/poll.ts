import type { TriggerContext } from "./trigger.js";

/** what `poll` reads of a trigger's `ctx` */
export type PollContext = Pick<TriggerContext, "signal" | "logger" | "fail">;

/** one round's answer: `"again"` runs the next tick at once, anything else waits `every` */
export type PollTick = "again" | void;

export type PollOptions = {
	/** how long to wait between ticks, in milliseconds */
	every: number;
	/** one round of work. Return `"again"` when there may be more to read right away */
	tick(): PollTick | Promise<PollTick>;
	/**
	 * What to do when `tick` throws. The default logs a warning and waits `every`.
	 * Return `"fail"` (or throw) to stop the trigger with `ctx.fail`: use it for
	 * errors that never fix themselves. An error raised after the trigger
	 * stopped is never reported.
	 */
	onError?(error: unknown): "fail" | void | Promise<"fail" | void>;
};

/**
 * Resolves after `ms`, or at once when `signal` aborts. It resolves rather than
 * rejects on abort, so a loop only has to re-check `signal.aborted`, and it
 * always removes its listener.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = () => {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		};
		timer = setTimeout(done, ms);
		signal?.addEventListener("abort", done, { once: true });
		// the abort may have landed between the check above and the listener
		if (signal?.aborted) done();
	});
}

/** what a failed tick ends with: undefined continues, "fail" stops, true stops after a throw */
async function afterError(
	ctx: PollContext,
	onError: PollOptions["onError"],
	error: unknown,
): Promise<boolean> {
	let decision: unknown;
	try {
		if (onError) decision = await onError(error);
		else ctx.logger.logWarn(error);
	} catch (fatal) {
		if (!ctx.signal.aborted) ctx.fail(fatal);
		return true;
	}
	if (decision !== "fail") return false;
	if (!ctx.signal.aborted) ctx.fail(error);
	return true;
}

/**
 * Runs `tick` until `ctx.signal` aborts, and returns the stop function `start`
 * resolves to. It waits `every` between ticks unless `tick` returned `"again"`,
 * and waits for a running tick to finish, so the runtime's stop timeout still
 * applies. It never commits or acknowledges anything: delivery stays yours.
 */
export function poll(ctx: PollContext, options: PollOptions): () => Promise<void> {
	const { signal } = ctx;
	const loop = (async () => {
		while (!signal.aborted) {
			let again = false;
			try {
				again = (await options.tick()) === "again";
			} catch (error) {
				// a failure while stopping is part of stopping, not a reason to fail
				if (signal.aborted || (await afterError(ctx, options.onError, error))) return;
			}
			if (signal.aborted) return;
			if (!again) await sleep(options.every, signal);
		}
	})();
	return async () => {
		await loop;
	};
}
