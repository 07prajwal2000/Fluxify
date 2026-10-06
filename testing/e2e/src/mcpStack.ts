// An admin server with the MCP endpoint, run as its own process by
// `mcp.ts`. It has to be: the server caches its env on first import, and the
// rest of this suite imports server modules long before a test could point it
// at a fresh Postgres. Prints one `MCP_STACK <json>` line once it serves, and
// shuts down when its stdin closes.
import {
	createProject,
	createUser,
	req,
	signIn,
	startAuthServer,
	stopAuthServer,
} from "@fluxify/ai-gateway/src/mcp/tests/authHarness";

const s = await startAuthServer();
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
const workflow = await insert<{ id: string }>(schema.workflowsEntity, { name: "nightly", projectId });
const group = await insert<{ id: string }>(schema.triggerGroupsEntity, { name: "default", projectId });
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
	config: { host: "localhost", port: 6379 },
	projectId,
});

const server = Bun.serve({ port: 0, fetch: (request) => s.app.fetch(request) });

console.log(
	`MCP_STACK ${JSON.stringify({
		url: `http://127.0.0.1:${server.port}`,
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
server.stop(true);
await stopAuthServer();
process.exit(0);
