import { timingSafeEqual } from "node:crypto";
import { getEnv } from "../../lib/env";
import { LAG_PATH, lagMetricsToken } from "./lagShared";

/**
 * The supervisor's half of lag scaling (#963): the numbers the execution
 * process measured, and the endpoint KEDA's `metrics-api` scaler reads them from.
 * It is on the health port, never the traffic port, and it asks for the bearer
 * token the orchestrator wrote into the trigger's authentication.
 */

/** older than this, a number is not the source's backlog any more: it is unknown */
export const LAG_STALE_MS = 60_000;

const lags = new Map<string, { lag: number; at: number }>();

/** the child's report: a number, or null to withdraw it (unknown, or the trigger stopped) */
export function recordLag(triggerId: string, lag: number | null, now = Date.now()) {
	if (lag === null) lags.delete(triggerId);
	else lags.set(triggerId, { lag, at: now });
}

export const forgetLags = () => lags.clear();

const same = (a: string, b: string) => {
	const [x, y] = [Buffer.from(a), Buffer.from(b)];
	return x.length === y.length && timingSafeEqual(x, y);
};

let memo: { key: string | undefined; token: string } | undefined;
function tokenFor(key: string | undefined) {
	if (memo?.key !== key || memo === undefined) memo = { key, token: lagMetricsToken(key) };
	return memo.token;
}

/**
 * `GET /_/admin/api/triggers/<id>/lag`: `{ "lag": number }`, 503 while it is
 * unknown (KEDA counts that as a failed read and holds its fallback), 401
 * without the token. Null for any other path, so the health handler goes on.
 */
export function lagResponse(
	request: Request,
	now = Date.now(),
	key = getEnv("MASTER_ENCRYPTION_KEY"),
): Response | null {
	const id = LAG_PATH.exec(new URL(request.url).pathname)?.[1];
	if (!id) return null;
	const token = tokenFor(key);
	const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
	if (!token || !given || !same(given, token)) return new Response(null, { status: 401 });
	const entry = lags.get(id);
	if (!entry || now - entry.at > LAG_STALE_MS) return new Response(null, { status: 503 });
	return Response.json({ lag: entry.lag });
}
