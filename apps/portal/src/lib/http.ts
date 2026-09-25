import axios, { type InternalAxiosRequestConfig } from "axios";

// Relative base -> requests go through the Vite dev proxy (see vite.config.ts)
// and, in prod, through Caddy to the standalone server.
const API_BASE_URL = "/_/admin/api";

export const httpClient = axios.create({
	baseURL: API_BASE_URL,
	headers: { "Content-Type": "application/json" },
});

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;
const JITTER_MS = 250;

/**
 * Wait before retry `attempt` (1-based): `Retry-After` seconds when sent,
 * else 250ms → 500ms → 1s. Jitter spreads a burst of blocked requests so
 * they don't all hit the limit again at the same instant.
 */
export function retryDelayMs(retryAfter: unknown, attempt: number): number {
	const seconds = Number(retryAfter);
	const base =
		retryAfter != null && Number.isFinite(seconds) && seconds > 0
			? seconds * 1000
			: BASE_DELAY_MS * 2 ** (attempt - 1);
	return base + Math.random() * JITTER_MS;
}

type RetryConfig = InternalAxiosRequestConfig & { __retryCount?: number };

// The admin API is rate limited per user and answers 429 before running the
// handler, so re-sending any method is safe. Only 429 is retried.
httpClient.interceptors.response.use(undefined, async (error) => {
	const cfg = error.config as RetryConfig | undefined;
	if (error.response?.status !== 429 || !cfg || cfg.signal?.aborted) throw error;
	const attempt = (cfg.__retryCount ?? 0) + 1;
	cfg.__retryCount = attempt;
	if (attempt > MAX_RETRIES) throw error;
	await new Promise((r) =>
		setTimeout(r, retryDelayMs(error.response.headers["retry-after"], attempt)),
	);
	if (cfg.signal?.aborted) throw error;
	return httpClient.request(cfg);
});
