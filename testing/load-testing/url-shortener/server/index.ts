// Hand-coded twin of the Fluxify url-shortener routes, for a like-for-like comparison.
// Same contract: validation, status codes, cache key/TTL and the 3-try id insert.
import { SQL } from "bun";
import { Hono } from "hono";
import Redis from "ioredis";
import { generateId, ID_PATTERN } from "../id";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const CACHE_TTL_SECONDS = 3600;
const MAX_URL_LENGTH = 2048;
const ID_ATTEMPTS = 3;

const db = new SQL(process.env.PG_URL ?? "postgres://postgres:postgres@localhost:5432/urlshortener");
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const cacheKey = (id: string) => `url:${id}`;
const notFound = { error: "not_found" };

/** The url if it is an absolute http(s) URL within the length limit, else null. */
function validUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

/** Cache first, then Postgres; a database hit refills the cache. */
async function lookup(id: string): Promise<string | null> {
	const cached = await redis.get(cacheKey(id));
	if (cached !== null) return cached;
	const [row] = await db`SELECT url FROM short_urls WHERE id = ${id}`;
	if (!row) return null;
	await redis.set(cacheKey(id), row.url, "EX", CACHE_TTL_SECONDS);
	return row.url;
}

const app = new Hono();

app.post("/api/urls", async (c) => {
	const body = await c.req.json().catch(() => null);
	const url = validUrl(body?.url);
	if (!url) return c.json({ error: "invalid_url" }, 400);

	for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
		const id = generateId();
		const rows = await db`INSERT INTO short_urls (id, url) VALUES (${id}, ${url}) ON CONFLICT (id) DO NOTHING RETURNING id`;
		if (rows.length === 0) continue; // id collision, try another
		await redis.set(cacheKey(id), url, "EX", CACHE_TTL_SECONDS);
		return c.json({ id, url, shortUrl: `${BASE_URL}/r/${id}` }, 201);
	}
	return c.json({ error: "id_generation_failed" }, 500);
});

app.get("/api/urls/:id", async (c) => {
	const id = c.req.param("id");
	if (!ID_PATTERN.test(id)) return c.json(notFound, 404);
	const url = await lookup(id);
	return url ? c.json({ id, url }) : c.json(notFound, 404);
});

app.get("/r/:id", async (c) => {
	const id = c.req.param("id");
	if (!ID_PATTERN.test(id)) return c.json(notFound, 404);
	const url = await lookup(id);
	return url ? c.redirect(url, 302) : c.json(notFound, 404);
});

export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch };
