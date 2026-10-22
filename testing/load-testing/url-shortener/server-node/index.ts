// Node.js twin of ../server (Bun): the same routes and contract, with `pg` instead of Bun SQL
// and @hono/node-server instead of Bun.serve. Runs on Node's native TypeScript stripping.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import Redis from "ioredis";
import pg from "pg";
import { generateId, ID_PATTERN } from "../id.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const CACHE_TTL_SECONDS = 3600;
const MAX_URL_LENGTH = 2048;
const ID_ATTEMPTS = 3;

// max 10 is also Bun SQL's default pool size
const db = new pg.Pool({
	connectionString: process.env.PG_URL ?? "postgres://postgres:postgres@localhost:5432/urlshortener",
	max: 10,
});
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
	const { rows } = await db.query("SELECT url FROM short_urls WHERE id = $1", [id]);
	if (rows.length === 0) return null;
	await redis.set(cacheKey(id), rows[0].url, "EX", CACHE_TTL_SECONDS);
	return rows[0].url;
}

const app = new Hono();

app.post("/api/urls", async (c) => {
	const body = await c.req.json().catch(() => null);
	const url = validUrl(body?.url);
	if (!url) return c.json({ error: "invalid_url" }, 400);

	for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
		const id = generateId();
		const { rowCount } = await db.query(
			"INSERT INTO short_urls (id, url) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
			[id, url],
		);
		if (!rowCount) continue; // id collision, try another
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

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
