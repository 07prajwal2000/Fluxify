import { logger } from "@fluxify/common";
import type { Context, Next } from "hono";
import { expireCache, incrCache } from "../db/redis";
import { getEnv } from "../lib/env";

const WINDOW_SECONDS = 1;

/** Requests one user may send per second to the admin API. 0 disables it. */
function limit() {
	return Number(getEnv("ADMIN_RATE_LIMIT_PER_SEC") ?? 15);
}

/**
 * One guard rail for the whole admin surface: the control-plane process owns
 * the database connection, so an unbounded loop from a single user (buggy
 * client, stolen token, retrying script) degrades every project.
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
	return countRequest(c, next, `admin:${userId}`, max, WINDOW_SECONDS);
}

/**
 * For the OAuth endpoints anyone may call signed out (client registration,
 * token exchange). Bucketed by the client address the proxy forwards.
 *
 * ponytail: X-Forwarded-For is trusted as-is, so a caller that reaches the
 * server directly can spoof it. Fine for a flood guard; lock it to the proxy
 * hop if these endpoints ever need a hard limit.
 */
export function anonymousRateLimit(name: string, max: number, windowSeconds = 60) {
	return (c: Context, next: Next) => {
		const ip =
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
			c.req.header("x-real-ip") ||
			"unknown";
		return countRequest(c, next, `${name}:${ip}`, max, windowSeconds);
	};
}

async function countRequest(c: Context, next: Next, bucket: string, max: number, seconds: number) {
	const window = Math.floor(Date.now() / (seconds * 1000));
	const key = `ratelimit:${bucket}:${window}`;

	let count: number;
	try {
		count = await incrCache(key);
		if (count === 1) await expireCache(key, seconds);
	} catch (error) {
		// Fail open: a Redis blip must not lock people out of the product.
		logger.error("[RateLimit] Check failed, allowing request", { bucket, error });
		return next();
	}

	if (count > max) {
		const per = seconds === 1 ? "second" : `${seconds} seconds`;
		return c.json(
			{
				message: `Rate limit of ${max} requests per ${per} exceeded. Please retry shortly.`,
				type: "rate_limit",
			},
			429,
			{ "Retry-After": String(seconds) },
		);
	}
	await next();
}
