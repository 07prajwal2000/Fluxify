// The compiled Fluxify route graphs (../fluxify-worker/dist/artifacts.json) run as is, with
// everything around them reduced to the minimum: Fluxify's routing trie, the compiled JS
// loaded through instantiateCompiled, and a bare context that only hands out the slim
// PostgresAdapter / RedisIntegration. No dispatch, validation, tracing or worker context.
import { SQL } from "bun";
import { instantiateCompiled } from "../../../../packages/blocks/compiler";
import { RedisIntegration } from "../../../../packages/adapters/kv/redis";
import { PostgresAdapter } from "../../../../packages/adapters/db/postgresAdapter";
import { type HttpRoute, HttpRouteParser } from "../../../../packages/lib/routing/parser";

const artifacts: { key: string; value: any }[] = await Bun.file(
	process.env.ARTIFACTS ?? "./artifacts.json",
).json();

const sql = new SQL({
	adapter: "postgres",
	url: process.env.PG_URL ?? "postgres://postgres:postgres@localhost:5432/urlshortener",
	bigint: true,
	max: Number(process.env.PG_MAX ?? 10),
	connection: { statement_timeout: 30000 },
});
const dbAdapter = new PostgresAdapter(PostgresAdapter.createKysely(sql), sql);
const kvAdapter = new RedisIntegration({
	source: "url",
	url: process.env.REDIS_URL ?? "redis://localhost:6379",
});

const parser = new HttpRouteParser();
const runs = new Map<string, (ctx: any, input?: unknown) => Promise<any>>();
for (const { key, value } of artifacts) {
	if (!key.startsWith("route.")) continue;
	runs.set(value.routeId, instantiateCompiled(value.source));
	parser.upsertRoute({
		routeId: value.routeId,
		projectId: value.projectId,
		projectName: value.projectName,
		method: value.method,
		path: value.path,
	} as HttpRoute);
}

/** the request-scoped helpers the three graphs call; snippets also park their globals (dbQuery) on it */
function makeVars(params: Record<string, string>, body: unknown, headers: Headers) {
	return {
		getRouteParam: (name: string) => params[name],
		getRequestBody: () => body,
		setHeader: (name: string, value: string) => headers.set(name, String(value)),
	} as Record<string, unknown>;
}

const ctxBase = {
	dbFactory: { getDbAdapter: () => dbAdapter },
	kvFactory: { getKvAdapter: () => kvAdapter },
};

async function fetch(req: Request): Promise<Response> {
	const { pathname } = new URL(req.url);
	const match = parser.getRouteId(pathname, req.method as HttpRoute["method"]);
	const run = match && runs.get(match.routeId);
	if (!match || !run) return Response.json({ message: "Route not found" }, { status: 404 });

	const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined;
	const headers = new Headers();
	const result = await run(
		{ ...ctxBase, vars: makeVars(match.routeParams ?? {}, body, headers) },
		undefined,
	);
	const out = result?.output;
	if (!out) return Response.json({ message: String(result?.error ?? "no output") }, { status: 500 });
	const status = Number(out?.httpCode ?? 200);
	const data = out?.body;
	return typeof data === "string" || data == null
		? new Response(data ?? "", { status, headers })
		: Response.json(data, { status, headers });
}

export default { port: Number(process.env.PORT ?? 3000), fetch };
