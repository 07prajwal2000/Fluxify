// An admin server with the MCP endpoint, run as its own process by
// `mcp.ts`. It has to be: the server caches its env on first import, and the
// rest of this suite imports server modules long before a test could point it
// at a fresh Postgres. Prints one `MCP_STACK <json>` line once it serves, and
// shuts down when its stdin closes.
//
// Like the kit, one origin serves both: /_/admin goes to the admin app, every
// other path to a real compiled worker, so call_route and run_workflow run for real.
import { join } from "node:path";
import {
	createProject,
	createUser,
	req,
	signIn,
	startAuthServer,
	stopAuthServer,
} from "@fluxify/ai-gateway/src/mcp/tests/authHarness";

/** A port nothing listens on yet. */
function freePort() {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() });
	const { port } = probe;
	probe.stop(true);
	return port;
}

const workerPort = freePort();
const workerHealthPort = freePort();
let admin: ((request: Request) => Response | Promise<Response>) | undefined;
const server = Bun.serve({
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/_/admin") || url.pathname.startsWith("/.well-known")) {
			return admin ? admin(request) : new Response("starting", { status: 503 });
		}
		return fetch(`http://127.0.0.1:${workerPort}${url.pathname}${url.search}`, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});
	},
});
const url = `http://127.0.0.1:${server.port}`;

// call_route sends to SERVER_URL, the project's public origin
const s = await startAuthServer({ SERVER_URL: url });
admin = (request) => s.app.fetch(request);
const schema = await import("@fluxify/server/src/db/schema");

async function apiKey(email: string) {
	const cookie = await signIn(s, email);
	const res = await req(s, "/_/admin/api/auth/api-key/create", { cookie, json: { name: "e2e" } });
	if (!res.ok) throw new Error(`api key: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { key: string }).key;
}

async function insert<T extends { id: unknown }>(table: any, values: object): Promise<T> {
	const [row] = await s.db.insert(table).values(values).returning();
	return row as T;
}

const projectId = await createProject(s);
const otherProjectId = await createProject(s);

const tokens: Record<string, string> = {};
for (const role of ["viewer", "creator", "project_admin"] as const) {
	tokens[role] = await apiKey((await createUser(s, role, projectId)).email);
}
tokens.other = await apiKey((await createUser(s, "viewer", otherProjectId)).email);

const route = await insert<{ id: string }>(schema.routesEntity, {
	name: "hello",
	path: "/hello",
	method: "GET",
	active: true,
	projectId,
});
// active, so run_workflow may queue it
const workflow = await insert<{ id: string }>(schema.workflowsEntity, {
	name: "nightly",
	projectId,
	active: true,
});
const group = await insert<{ id: string }>(schema.triggerGroupsEntity, {
	name: "default",
	projectId,
	isDefault: true,
});
const trigger = await insert<{ id: string }>(schema.triggersEntity, {
	name: "every-hour",
	type: "schedule",
	schedule: "0 * * * *",
	projectId,
	groupId: group.id,
	workflowId: workflow.id,
});
const customBlock = await insert<{ id: string }>(schema.customBlocksListEntity, {
	name: "audit",
	label: "Audit",
	projectId,
	inputParams: [{ name: "level", type: "text_input" }],
});
const middleware = await insert<{ id: string }>(schema.middlewaresEntity, { name: "auth", projectId });
const testSuite = await insert<{ id: string }>(schema.testSuitesEntity, {
	name: "says hello",
	routeId: route.id,
});
const appConfig = await insert<{ id: number }>(schema.appConfigEntity, {
	keyName: "GREETING",
	value: "hello",
	encodingType: "plaintext",
	projectId,
});
const integration = await insert<{ id: string }>(schema.integrationsEntity, {
	name: "cache",
	group: "kv",
	variant: "Redis",
	// the stack's own Redis, so a connection test really connects
	config: { source: "credentials", host: "127.0.0.1", port: Number(process.env.REDIS_PORT) },
	projectId,
});

// the real compiled worker, serving every project from the artifacts the
// compile worker writes
const worker = Bun.spawn(
	["bun", join(import.meta.dir, "../../../apps/server/deployments/compiledWorker.ts")],
	{
		env: {
			...process.env,
			WORKER_PROJECT_ID: "*",
			WORKER_MODE: "both",
			WORKER_PORT: String(workerPort),
			WORKER_HEALTH_PORT: String(workerHealthPort),
		},
		stdout: "ignore",
		stderr: "inherit",
	},
);
const deadline = Date.now() + 60_000;
while (
	!(await fetch(`http://127.0.0.1:${workerHealthPort}/_/admin/api/healthchecks/ready`)
		.then((r) => r.ok)
		.catch(() => false))
) {
	if (Date.now() > deadline || worker.exitCode !== null) throw new Error("compiled worker never became ready");
	await Bun.sleep(250);
}

console.log(
	`MCP_STACK ${JSON.stringify({
		url,
		projectId,
		otherProjectId,
		tokens,
		ids: {
			route: route.id,
			workflow: workflow.id,
			trigger: trigger.id,
			customBlock: customBlock.id,
			middleware: middleware.id,
			testSuite: testSuite.id,
			appConfig: appConfig.id,
			integration: integration.id,
		},
	})}`,
);

// stdin closes when the parent test finishes, or dies
for await (const _ of Bun.stdin.stream()) {
}
worker.kill();
await worker.exited;
server.stop(true);
await stopAuthServer();
process.exit(0);
