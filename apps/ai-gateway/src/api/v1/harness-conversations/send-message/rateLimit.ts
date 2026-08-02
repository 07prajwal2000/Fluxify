import { HttpError, incrCache, expireCache } from "@fluxify/server";
import { logger } from "@fluxify/common";

/** Runs one user may start per window. 0 disables the limit. */
const RUNS_PER_WINDOW = Number(process.env.HARNESS_RUNS_PER_HOUR ?? 30);
const WINDOW_SECONDS = 3600;

/**
 * Caps how many harness runs one user can start per hour.
 *
 * The provider key belongs to the project, so without this any user with
 * project access can drain its quota — one conversation at a time, but any
 * number of conversations at once (`isConversationLocked` is per conversation).
 *
 * ponytail: fixed window, so a user can burst 2x the limit across a window
 * boundary. Move to a sliding window only if that turns out to matter — the
 * per-run deadline and token budget bound the damage either way.
 */
export async function assertRunQuota(userId: string): Promise<void> {
	if (RUNS_PER_WINDOW <= 0) return;

	const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
	const key = `harness:runquota:${userId}:${window}`;

	let count: number;
	try {
		count = await incrCache(key);
		if (count === 1) await expireCache(key, WINDOW_SECONDS);
	} catch (error) {
		// Fail open: a Redis blip must not stop people from using the product.
		// The run itself is still bounded by its deadline and token budget.
		logger.error("[HarnessRateLimit] Quota check failed, allowing request", {
			userId,
			error,
		});
		return;
	}

	if (count > RUNS_PER_WINDOW) {
		throw new HttpError(
			429,
			`You have started ${RUNS_PER_WINDOW} AI requests in the last hour, which is the limit. Please try again later.`,
		);
	}
}
