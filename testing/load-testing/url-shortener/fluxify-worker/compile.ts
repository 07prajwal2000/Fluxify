// Compiles the exported canvases in ../fluxify-raw-routes into the artifacts a Fluxify
// worker loads (what the admin's compiler would publish to NATS KV), plus a project-config
// artifact holding the Postgres and Valkey integrations the canvases name. Output: dist/artifacts.json.
//   bun compile.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileGraph } from "../../../../packages/blocks/compiler";

const PROJECT_ID = "01a164b0-0000-7000-8000-000000000001";
const DB_ID = "01a16498-0106-7e64-85de-7fd4dc983bff";
const KV_ID = "01a16498-436a-7ad5-b506-157286045606";
const OWNER_KEY = "__projectId";

const ROUTES = [
	{ file: "create-route", id: "01a164b0-0000-7000-8000-0000000000a1", method: "POST", path: "/api/urls" },
	{ file: "get-by-id", id: "01a164b0-0000-7000-8000-0000000000a2", method: "GET", path: "/api/urls/:id" },
	{ file: "redirect", id: "01a164b0-0000-7000-8000-0000000000a3", method: "GET", path: "/r/:id" },
];

const compiledAt = new Date().toISOString();
const entries: { key: string; value: unknown }[] = [];

for (const r of ROUTES) {
	const raw = readFileSync(resolve(import.meta.dir, `../fluxify-raw-routes/${r.file}.fluxcanvas`), "utf8");
	const canvas = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
	const blocks = canvas.blocks.filter((b: { type: string }) => b.type !== "sticky_note");
	// the compiler reads the stored edge convention, which swaps the two handles (graph.ts)
	const edges = canvas.edges.map((e: any) => ({
		id: e.id,
		from: e.from,
		to: e.to,
		fromHandle: e.toHandle,
		toHandle: e.fromHandle,
	}));
	// tracing off, as a route with tracing disabled compiles
	const { source } = compileGraph(blocks, edges, { projectId: PROJECT_ID, tracing: false });
	entries.push({
		key: `route.${PROJECT_ID}.${r.id}`,
		value: {
			routeId: r.id,
			projectId: PROJECT_ID,
			projectName: "url-shortener",
			method: r.method,
			path: r.path,
			timeoutSeconds: 30,
			acceptedContentTypes: ["application/json"],
			bodyMode: "buffer",
			tracingEnabled: false,
			recordExecution: false,
			routeVersion: compiledAt,
			source,
			compiledAt,
		},
	});
}

const pg = process.env.PG_URL_PARTS ?? "postgres:postgres@lt-urlshortener-postgres:5432/urlshortener";
const [auth, hostDb] = pg.split("@");
const [username, password] = auth.split(":");
const [hostPort, database] = hostDb.split("/");
const [host, port] = hostPort.split(":");

entries.push({
	key: `project-config.${PROJECT_ID}.current`,
	value: {
		projectId: PROJECT_ID,
		compiledAt,
		payload: {
			appConfig: {},
			dbIntegrations: {
				[DB_ID]: {
					username, password, host, port: Number(port), database, ssl: false,
					dbType: "pg", variant: "PostgreSQL", group: "database", [OWNER_KEY]: PROJECT_ID,
				},
			},
			kvIntegrations: {
				[KV_ID]: {
					source: "url", url: "redis://lt-urlshortener-valkey:6379",
					variant: "Redis", group: "kv", [OWNER_KEY]: PROJECT_ID,
				},
			},
			observabilityIntegrations: {},
			aiIntegrations: {},
			queueIntegrations: {},
			pluginIntegrations: {},
			// like the Fluxify project the canvases came from: it answers on its own subdomain
			projectSettings: { "settings.routing.subdomain": "fw" },
		},
	},
});

mkdirSync(resolve(import.meta.dir, "dist"), { recursive: true });
writeFileSync(resolve(import.meta.dir, "dist/artifacts.json"), JSON.stringify(entries));
console.log(`wrote ${entries.length} artifacts`);
for (const e of entries) if (e.key.startsWith("route.")) console.log(e.key, (e.value as any).source.length, "chars");
