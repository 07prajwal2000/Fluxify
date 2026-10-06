import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readTools } from "@fluxify/ai-gateway/src/mcp/tools";
import { writeTools } from "@fluxify/ai-gateway/src/mcp/writeTools";
import {
	type AdminCall,
	adminCall,
	adminStatus,
	callTool,
	type McpStack,
	mcp,
	startMcpStack,
	stopMcpStack,
} from "../src/mcp";

/**
 * MCP tools never check roles: they call the admin API with the caller's own
 * token. So a tool must succeed exactly when the same call made directly
 * succeeds, for every role. Later PRs add their tools as rows here.
 */
type Row = { tool: string; args: object; api: string | AdminCall };

const allTools = [...readTools, ...writeTools];
const uniq = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

/** Creates a resource as the creator, for a delete row to remove. */
async function fresh(s: McpStack, path: string, body: object) {
	const res = await adminCall(s, s.tokens.creator, { method: "POST", path, body });
	if (res.status >= 300) throw new Error(`seed ${path}: ${res.status} ${JSON.stringify(res.body)}`);
	return res.body.id;
}

/**
 * Write rows. Each create uses a fresh name, and each delete removes its own
 * fresh resource (one for the tool, one for the direct call), so roles and
 * repeat runs never collide.
 */
async function writeRows(s: McpStack): Promise<Row[]> {
	const { projectId: p, ids } = s;
	const integration = `/v1/${p}/integrations/${ids.integration}`;
	const redis = (await adminCall(s, s.tokens.creator, { path: integration })).body.config;
	const two = (path: string, body: () => object) =>
		Promise.all([fresh(s, path, body()), fresh(s, path, body())]);
	// a group holds 5 triggers at most, so each set of rows gets its own
	const groupId = await fresh(s, "/v1/triggers/groups", { projectId: p, name: uniq("g-") });
	const triggerBody = () => ({ projectId: p, groupId, name: uniq("t-"), type: "internal" });
	const middlewareBody = () => ({ projectId: p, name: uniq("m-") });
	const blockBody = () => ({ projectId: p, name: uniq("cb_"), label: "Temp" });
	const configBody = () => ({
		keyName: uniq("K_"),
		value: "v",
		description: "",
		isEncrypted: false,
		encodingType: "plaintext",
	});
	const kvBody = () => ({ name: uniq("kv-"), group: "kv", variant: "Redis", config: redis });
	const [t, m, cb, ac, ig] = await Promise.all([
		two("/v1/triggers", triggerBody),
		two("/v1/middlewares", middlewareBody),
		two("/v1/custom-blocks", blockBody),
		two(`/v1/${p}/app-config`, configBody),
		two(`/v1/${p}/integrations`, kvBody),
	]);
	const post = (path: string, body: object) => ({ method: "POST", path, body });
	const put = (path: string, body: object) => ({ method: "PUT", path, body });
	const del = (path: string) => ({ method: "DELETE", path });
	return [
		{ tool: "save_trigger", args: triggerBody(), api: post("/v1/triggers", triggerBody()) },
		{
			tool: "save_trigger",
			args: { triggerId: ids.trigger, description: "hourly" },
			api: { method: "PATCH", path: `/v1/triggers/${ids.trigger}`, body: { description: "hourly" } },
		},
		{ tool: "delete_trigger", args: { triggerId: t[0] }, api: del(`/v1/triggers/${t[1]}`) },
		{ tool: "save_middleware", args: middlewareBody(), api: post("/v1/middlewares", middlewareBody()) },
		{
			tool: "save_middleware",
			args: { middlewareId: ids.middleware, description: "checks auth" },
			api: put(`/v1/middlewares/${ids.middleware}`, { description: "checks auth" }),
		},
		{ tool: "delete_middleware", args: { middlewareId: m[0] }, api: del(`/v1/middlewares/${m[1]}`) },
		{ tool: "save_custom_block", args: blockBody(), api: post("/v1/custom-blocks", blockBody()) },
		{
			tool: "save_custom_block",
			args: { customBlockId: ids.customBlock, label: "Audit" },
			api: put(`/v1/custom-blocks/${ids.customBlock}`, { label: "Audit" }),
		},
		{
			tool: "delete_custom_block",
			args: { customBlockId: cb[0] },
			api: del(`/v1/custom-blocks/${cb[1]}`),
		},
		{
			tool: "save_app_config",
			args: { projectId: p, ...configBody() },
			api: post(`/v1/${p}/app-config`, configBody()),
		},
		{
			tool: "save_app_config",
			args: { projectId: p, appConfigId: ids.appConfig, description: "greeting" },
			api: put(`/v1/${p}/app-config/${ids.appConfig}`, {
				keyName: "GREETING",
				description: "greeting",
				isEncrypted: false,
				encodingType: "plaintext",
			}),
		},
		{
			tool: "delete_app_config",
			args: { projectId: p, appConfigId: ac[0] },
			api: del(`/v1/${p}/app-config/${ac[1]}`),
		},
		{
			tool: "save_integration",
			args: { projectId: p, ...kvBody() },
			api: post(`/v1/${p}/integrations`, kvBody()),
		},
		{
			tool: "save_integration",
			args: { projectId: p, integrationId: ids.integration, name: "cache" },
			api: put(integration, { name: "cache", config: redis }),
		},
		{
			tool: "delete_integration",
			args: { projectId: p, integrationId: ig[0] },
			api: del(`/v1/${p}/integrations/${ig[1]}`),
		},
		{
			tool: "test_integration_connection",
			args: { projectId: p, integrationId: ids.integration },
			api: `/v1/${p}/integrations/test-existing-connection/${ids.integration}`,
		},
	];
}

function readRows({ projectId: p, ids }: McpStack): Row[] {
	return [
		{ tool: "get_instance_info", args: {}, api: "/public-settings" },
		{ tool: "list_projects", args: {}, api: "/v1/projects/list" },
		{ tool: "get_project", args: { projectId: p }, api: `/v1/projects/${p}` },
		{ tool: "get_system_logs", args: { projectId: p }, api: `/v1/projects/${p}/system-logs` },
		{ tool: "list_routes", args: { projectId: p }, api: `/v1/routes/list?projectId=${p}` },
		{ tool: "get_route", args: { routeId: ids.route }, api: `/v1/routes/${ids.route}` },
		{ tool: "list_workflows", args: { projectId: p }, api: `/v1/workflows/list?projectId=${p}` },
		{
			tool: "get_workflow",
			args: { workflowId: ids.workflow },
			api: `/v1/workflows/${ids.workflow}`,
		},
		{ tool: "list_triggers", args: { projectId: p }, api: `/v1/triggers/list?projectId=${p}` },
		{ tool: "get_trigger", args: { triggerId: ids.trigger }, api: `/v1/triggers/${ids.trigger}` },
		{
			tool: "list_custom_blocks",
			args: { projectId: p },
			api: `/v1/custom-blocks/list?projectId=${p}`,
		},
		{
			tool: "get_custom_block",
			args: { customBlockId: ids.customBlock },
			api: `/v1/custom-blocks/${ids.customBlock}`,
		},
		{
			tool: "list_middlewares",
			args: { projectId: p },
			api: `/v1/middlewares/list?projectId=${p}`,
		},
		{
			tool: "get_middleware",
			args: { middlewareId: ids.middleware },
			api: `/v1/middlewares/${ids.middleware}`,
		},
		{
			tool: "list_test_suites",
			args: { targetType: "route", targetId: ids.route },
			api: `/v1/test-suites/route/${ids.route}`,
		},
		{
			tool: "get_test_suite",
			args: { testSuiteId: ids.testSuite },
			api: `/v1/test-suites/${ids.testSuite}`,
		},
		{ tool: "list_app_config", args: { projectId: p }, api: `/v1/${p}/app-config/list` },
		{
			tool: "get_app_config",
			args: { projectId: p, appConfigId: ids.appConfig },
			api: `/v1/${p}/app-config/${ids.appConfig}`,
		},
		{
			tool: "list_integrations",
			args: { projectId: p },
			api: `/v1/${p}/integrations/list-basic`,
		},
		{
			tool: "get_integration",
			args: { projectId: p, integrationId: ids.integration },
			api: `/v1/${p}/integrations/${ids.integration}`,
		},
		{
			tool: "list_members",
			args: { projectId: p },
			api: `/v1/projects/${p}/settings/members/list`,
		},
		// reads no project data; any signed-in caller gets it, like public-settings
		{ tool: "get_block_schemas", args: {}, api: "/public-settings" },
	];
}

const ROLES = ["viewer", "creator", "project_admin"] as const;
const RANK = { viewer: 0, creator: 1, project_admin: 2 };
const ROLE_NAMES = { viewer: "Viewer", creator: "Creator", project_admin: "Project Admin" };

let stack: McpStack;

beforeAll(async () => {
	stack = await startMcpStack();
}, 300_000);

afterAll(stopMcpStack);

describe("MCP role matrix", () => {
	it("has a row for every tool", async () => {
		const tools = new Set([...readRows(stack), ...(await writeRows(stack))].map((r) => r.tool));
		expect([...tools].sort()).toEqual(allTools.map((t) => t.name).sort());
	});

	for (const role of ROLES) {
		it(`${role}: each tool succeeds exactly when the admin API does`, async () => {
			const token = stack.tokens[role];
			for (const row of [...readRows(stack), ...(await writeRows(stack))]) {
				const needs = allTools.find((t) => t.name === row.tool)!.role;
				const [status, result] = await Promise.all([
					adminStatus(stack, token, row.api),
					callTool(stack, token, row.tool, row.args),
				]);
				// pinning the expected status keeps the matrix honest: a server that
				// 200s everything would otherwise pass. Writes may answer 201 or 204.
				const got = status < 300 ? "ok" : status;
				expect(`${row.tool} ${got}`).toBe(`${row.tool} ${RANK[role] >= RANK[needs] ? "ok" : 403}`);
				expect(`${row.tool} ok=${result.ok}: ${result.text.slice(0, 200)}`).toStartWith(
					`${row.tool} ok=${status < 300}`,
				);
				if (status === 403) {
					expect(result.text).toBe(`You need the ${ROLE_NAMES[needs]} role in this project.`);
				}
			}
		});
	}

	it("trims a get to what the model needs", async () => {
		const { text } = await callTool(stack, stack.tokens.creator, "get_route", {
			routeId: stack.ids.route,
		});
		expect(JSON.parse(text)).toEqual({
			id: stack.ids.route,
			name: "hello",
			method: "GET",
			path: "/hello",
			active: true,
			timeoutSeconds: 30,
			tracingEnabled: false,
			recordExecution: false,
			acceptedContentTypes: expect.any(Array),
		});
	});
});

describe("MCP writes", () => {
	const call = async (tool: string, args: object) => {
		const r = await callTool(stack, stack.tokens.creator, tool, args);
		if (!r.ok) throw new Error(`${tool}: ${r.text}`);
		return JSON.parse(r.text);
	};

	it("creates, updates and deletes a middleware", async () => {
		const name = uniq("rt-");
		const { id } = await call("save_middleware", { projectId: stack.projectId, name });
		expect((await call("get_middleware", { middlewareId: id })).name).toBe(name);

		await call("save_middleware", { middlewareId: id, name: `${name}-2`, description: "renamed" });
		expect(await call("get_middleware", { middlewareId: id })).toEqual({
			id,
			name: `${name}-2`,
			description: "renamed",
			blocks: [],
		});

		expect(await call("delete_middleware", { middlewareId: id })).toEqual({ deleted: id });
		const gone = await callTool(stack, stack.tokens.creator, "get_middleware", { middlewareId: id });
		expect(gone.ok).toBe(false);
		expect(gone.text).toStartWith("Not found");
	});

	it("never echoes a secret back", async () => {
		const p = stack.projectId;
		const secret = "s3cret-value-for-mcp";
		const created = await call("save_app_config", {
			projectId: p,
			keyName: uniq("API_KEY_"),
			value: secret,
			description: "",
			isEncrypted: true,
			encodingType: "plaintext",
		});
		expect(Object.keys(created)).toEqual(["id"]);
		const updated = await call("save_app_config", {
			projectId: p,
			appConfigId: created.id,
			value: secret,
		});
		expect(updated).toEqual({ id: created.id });
		const read = await call("get_app_config", { projectId: p, appConfigId: created.id });
		expect(read.value).not.toContain(secret);
		expect(read.isEncrypted).toBe(true);
	});

	it("a connection test really connects", async () => {
		const result = await call("test_integration_connection", {
			projectId: stack.projectId,
			integrationId: stack.ids.integration,
		});
		expect(result).toMatchObject({ success: true });
	});
});

describe("MCP isolation", () => {
	it("two clients calling at once each see only their own projects", async () => {
		const listAs = async (token: string) => {
			const { text } = await callTool(stack, token, "list_projects", {});
			return JSON.parse(text).items.map((p: { id: string }) => p.id);
		};
		const calls = Array.from({ length: 5 }, () => [
			listAs(stack.tokens.viewer),
			listAs(stack.tokens.other),
		]).flat();
		const results = await Promise.all(calls);
		results.forEach((ids, i) => {
			expect(ids).toEqual([i % 2 === 0 ? stack.projectId : stack.otherProjectId]);
		});
	});

	it("each client's whoami is its own user", async () => {
		const [a, b] = await Promise.all(
			[stack.tokens.viewer, stack.tokens.other].map(async (token) => {
				const r = await mcp(stack, token, "tools/call", { name: "whoami", arguments: {} });
				return JSON.parse(r.content[0].text).acl;
			}),
		);
		expect(a).toEqual([{ projectId: stack.projectId, role: "viewer" }]);
		expect(b).toEqual([{ projectId: stack.otherProjectId, role: "viewer" }]);
	});
});
