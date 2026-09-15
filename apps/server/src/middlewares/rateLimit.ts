import { Context, type Next } from "hono";
import { logger } from "@fluxify/common";
import { incrCache, expireCache } from "../db/redis";
import { getEnv } from "../lib/env";

const WINDOW_SECONDS = 1;

/** Requests one user may send per second to the admin API. 0 disables it. */
function limit() {
	return Number(getEnv("ADMIN_RATE_LIMIT_PER_SEC") ?? 10);
}

/**
 * One guard rail for the whole admin surface: the control-plane process owns
 * the database connection, so an unbounded loop from a single user (buggy
 * client, stolen token, retrying harness) degrades every project.
 *
 * Anonymous requests are not limited — the server sits behind a proxy, so the
 * only IP available is the proxy's and would bucket every logged-out visitor
 * together.
 *
 * ponytail: fixed 1s window, so a user can burst 2x the limit across a window
 * boundary. Move to a sliding window only if that turns out to matter.
 */
export async function adminRateLimit(c: Context, next: Next) {
	const max = limit();
	const userId = c.get("user")?.id;
	if (max <= 0 || !userId) return next();

	const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
	const key = `ratelimit:admin:${userId}:${window}`;

	let count: number;
	try {
		count = await incrCache(key);
		if (count === 1) await expireCache(key, WINDOW_SECONDS);
	} catch (error) {
		// Fail open: a Redis blip must not lock people out of the product.
		logger.error("[AdminRateLimit] Check failed, allowing request", {
			userId,
			error,
		});
		return next();
	}

	if (count > max) {
		return c.json(
			{
				message: `Rate limit of ${max} requests per second exceeded. Please retry shortly.`,
				type: "rate_limit",
			},
			429,
			{ "Retry-After": String(WINDOW_SECONDS) },
		);
	}
	await next();
}
