// Hono swapped for Fluxify's own routing trie (HttpRouteParser) with the routes hardcoded.
// Same contract as ../server, but the data layers are Fluxify's own PostgresAdapter and RedisIntegration
// (Kysely over Bun SQL, same pool options as the worker). Isolates the cost of that layer.
import { SQL } from "bun";
import { HttpRouteParser, type HttpRoute } from "../../../../packages/lib/routing/parser";
import { RedisIntegration } from "../../../../packages/adapters/kv/redis";
import { PostgresAdapter } from "../../../../packages/adapters/db/postgresAdapter";
import { generateId, ID_PATTERN } from "../id";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const CACHE_TTL_SECONDS = 3600;
const MAX_URL_LENGTH = 2048;
const ID_ATTEMPTS = 3;
const TABLE = "short_urls";

const sql = new SQL({
	adapter: "postgres",
	url: process.env.PG_URL ?? "postgres://postgres:postgres@localhost:5432/urlshortener",
	bigint: true, // as in connectPostgres
	max: Number(process.env.PG_MAX ?? 10),
	connection: { statement_timeout: 30000 },
});
const adapter = new PostgresAdapter(PostgresAdapter.createKysely(sql), sql);
// Fluxify's KV adapter (a thin layer over ioredis), as the KV blocks use it
const redis = new RedisIntegration({
	source: "url",
	url: process.env.REDIS_URL ?? "redis://localhost:6379",
});

const cacheKey = (id: string) => `url:${id}`;
const notFound = { error: "not_found" };

function validUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

/** Cache first, then Postgres through the adapter; a database hit refills the cache. */
async function lookup(id: string): Promise<string | null> {
	const cached = await redis.get(cacheKey(id));
	if (cached !== null) return cached;
	const row = await adapter.getSingle(TABLE, [
		{ attribute: "id", operator: "eq", value: id, chain: "and" },
	]);
	if (!row) return null;
	await redis.setex(cacheKey(id), CACHE_TTL_SECONDS, row.url);
	return row.url;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;

const handlers = new Map<string, Handler>([
	[
		"create",
		async (req) => {
			const body = await req.json().catch(() => null);
			const url = validUrl(body?.url);
			if (!url) return json({ error: "invalid_url" }, 400);
			for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
				const id = generateId();
				const row = await adapter.insert(TABLE, { id, url }, { target: ["id"], action: "ignore" });
				if (!row) continue; // id collision, try another
				await redis.setex(cacheKey(id), CACHE_TTL_SECONDS, url);
				return json({ id, url, shortUrl: `${BASE_URL}/r/${id}` }, 201);
			}
			return json({ error: "id_generation_failed" }, 500);
		},
	],
	[
		"get",
		async (_req, { id }) => {
			if (!ID_PATTERN.test(id)) return json(notFound, 404);
			const url = await lookup(id);
			return url ? json({ id, url }) : json(notFound, 404);
		},
	],
	[
		"redirect",
		async (_req, { id }) => {
			if (!ID_PATTERN.test(id)) return json(notFound, 404);
			const url = await lookup(id);
			return url ? Response.redirect(url, 302) : json(notFound, 404);
		},
	],
]);

const route = (routeId: string, method: HttpRoute["method"], path: string): HttpRoute => ({
	routeId,
	projectId: "p",
	projectName: "url-shortener",
	path,
	method,
});
const parser = new HttpRouteParser();
parser.rebuildRoutes([
	route("create", "POST", "/api/urls"),
	route("get", "GET", "/api/urls/:id"),
	route("redirect", "GET", "/r/:id"),
]);

async function fetch(req: Request): Promise<Response> {
	const { pathname } = new URL(req.url);
	const match = parser.getRouteId(pathname, req.method as HttpRoute["method"]);
	const handler = match && handlers.get(match.routeId);
	return handler ? handler(req, match.routeParams ?? {}) : json({ error: "route_not_found" }, 404);
}

export default { port: Number(process.env.PORT ?? 3000), fetch };
