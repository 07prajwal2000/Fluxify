import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readTools } from "@fluxify/ai-gateway/src/mcp/tools";
import { adminStatus, callTool, type McpStack, mcp, startMcpStack, stopMcpStack } from "../src/mcp";

/**
 * MCP tools never check roles: they call the admin API with the caller's own
 * token. So a tool must succeed exactly when the same read made directly
 * succeeds, for every role. Later PRs add their tools as rows here.
 */
type Row = { tool: string; args: object; api: string };

function rows({ projectId: p, ids }: McpStack): Row[] {
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
	it("has a row for every tool", () => {
		expect(rows(stack).map((r) => r.tool).sort()).toEqual(readTools.map((t) => t.name).sort());
	});

	for (const role of ROLES) {
		it(`${role}: each tool succeeds exactly when the admin API does`, async () => {
			const token = stack.tokens[role];
			for (const row of rows(stack)) {
				const needs = readTools.find((t) => t.name === row.tool)!.role;
				const [status, result] = await Promise.all([
					adminStatus(stack, token, row.api),
					callTool(stack, token, row.tool, row.args),
				]);
				// pinning the expected status keeps the matrix honest: a server that
				// 200s everything would otherwise pass
				expect(`${row.tool} ${status}`).toBe(`${row.tool} ${RANK[role] >= RANK[needs] ? 200 : 403}`);
				expect(`${row.tool} ok=${result.ok}: ${result.text.slice(0, 200)}`).toStartWith(
					`${row.tool} ok=${status === 200}`,
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
