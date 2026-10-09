import { canvasTools } from "@fluxify/ai-gateway/src/mcp/canvasTools";
import { projectTools } from "@fluxify/ai-gateway/src/mcp/projectTools";
import { readTools } from "@fluxify/ai-gateway/src/mcp/tools";
import { routeTools } from "@fluxify/ai-gateway/src/mcp/routeTools";
import { writeTools } from "@fluxify/ai-gateway/src/mcp/writeTools";
import { type AdminCall, adminCall, type McpStack } from "./mcp";

/**
 * MCP tools never check roles: they call the admin API with the caller's own
 * token. So a tool must succeed exactly when the same call made directly
 * succeeds, for every role. Later PRs add their tools as rows here.
 */
export type Row = {
	tool: string;
	args: object;
	api: string | AdminCall;
	/** run only for roles the server refuses: the allowed call needs the npm registry, or a run that may not exist */
	deniedOnly?: true;
};

export const allTools = [...readTools, ...writeTools, ...routeTools, ...canvasTools, ...projectTools];
/** a run id no run has: the role check comes before the lookup */
const NO_RUN = "0199a000-0000-7000-8000-000000000000";
export const uniq =(prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

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
export async function writeRows(s: McpStack): Promise<Row[]> {
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
	const routeBody = () => {
		const name = uniq("r-");
		return { projectId: p, name, path: `/${name}`, method: "GET" };
	};
	const workflowBody = () => ({ projectId: p, name: uniq("w-") });
	const [t, m, cb, ac, ig, rt, wf] = await Promise.all([
		two("/v1/triggers", triggerBody),
		two("/v1/middlewares", middlewareBody),
		two("/v1/custom-blocks", blockBody),
		two(`/v1/${p}/app-config`, configBody),
		two(`/v1/${p}/integrations`, kvBody),
		two("/v1/routes", routeBody),
		two("/v1/workflows", workflowBody),
	]);
	const runs = `/v1/${p}/test-suites/route/${ids.route}/runs`;
	// project_admin adds x and y, then changes and removes them, so every pass starts clean
	const [x, y] = s.users;
	const members = `/v1/projects/${p}/settings/members`;
	const packages = `/v1/projects/${p}/settings/packages`;
	const routeCanvas = await adminCall(s, s.tokens.creator, { path: `/v1/routes/${ids.route}/canvas-items` });
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
		{ tool: "save_route", args: routeBody(), api: post("/v1/routes", routeBody()) },
		{
			tool: "save_route",
			args: { routeId: ids.route, tracingEnabled: false },
			api: { method: "PATCH", path: `/v1/routes/partial/${ids.route}`, body: { tracingEnabled: false } },
		},
		{ tool: "delete_route", args: { routeId: rt[0] }, api: del(`/v1/routes/${rt[1]}`) },
		{ tool: "save_workflow", args: workflowBody(), api: post("/v1/workflows", workflowBody()) },
		{
			tool: "save_workflow",
			args: { workflowId: ids.workflow, description: "runs nightly" },
			api: {
				method: "PATCH",
				path: `/v1/workflows/${ids.workflow}`,
				body: { description: "runs nightly" },
			},
		},
		{ tool: "delete_workflow", args: { workflowId: wf[0] }, api: del(`/v1/workflows/${wf[1]}`) },
		{
			tool: "call_route",
			args: { routeId: ids.route },
			api: post(`/v1/routes/${ids.route}/call`, { debug: true }),
		},
		// a check-only edit: a dry-run save, so the version stays put for every role
		{
			tool: "edit_canvas",
			args: {
				target: { kind: "route", id: ids.route },
				version: routeCanvas.body.canvasVersion,
				ops: [],
				validate: true,
			},
			api: put(`/v1/routes/${ids.route}/save-canvas?dryRun=true`, {
				actionsToPerform: { blocks: [], edges: [] },
				changes: { blocks: [], edges: [] },
			}),
		},
		// reads no project data, like get_block_schemas
		{
			tool: "get_integration_schema",
			args: { group: "kv", variant: "Redis" },
			api: "/public-settings",
		},
		{
			tool: "test_integration_connection",
			args: { projectId: p, integrationId: ids.integration },
			api: `/v1/${p}/integrations/test-existing-connection/${ids.integration}`,
		},
		{
			tool: "kv_get",
			args: { projectId: p, integrationId: ids.integration, key: "nope" },
			api: `${integration}/kv?key=nope`,
		},
		// the stack's integration is Redis, so an allowed call is a 400; the role check is what this row covers
		{
			tool: "get_integration_schema_details",
			args: { projectId: p, integrationId: ids.integration },
			api: `${integration}/schema`,
			deniedOnly: true,
		},
		{
			tool: "run_test_suite",
			args: { testSuiteId: ids.testSuite },
			api: post(runs, { suiteIds: [ids.testSuite] }),
		},
		{
			tool: "add_member",
			args: { projectId: p, user: x.email, role: "viewer" },
			api: post(`${members}/add`, { userId: y.id, role: "viewer" }),
		},
		{
			tool: "update_member_role",
			args: { projectId: p, userId: x.id, role: "creator" },
			api: put(`${members}/update/${y.id}`, { role: "creator" }),
		},
		{
			tool: "remove_member",
			args: { projectId: p, userId: x.id },
			api: del(`${members}/remove/${y.id}`),
		},
		{
			tool: "update_project",
			args: { projectId: p, description: "made by mcp" },
			api: put(`/v1/projects/${p}`, { description: "made by mcp" }),
		},
		{
			tool: "install_package",
			args: { projectId: p, packages: [{ name: "is-odd" }] },
			api: post(`${packages}/install`, { packages: [{ name: "is-odd" }] }),
			deniedOnly: true,
		},
		{
			tool: "remove_package",
			args: { projectId: p, names: ["is-odd"] },
			api: post(`${packages}/remove`, { names: ["is-odd"] }),
			deniedOnly: true,
		},
	];
}

export function readRows({ projectId: p, ids }: McpStack): Row[] {
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
		{
			tool: "get_canvas",
			args: { target: { kind: "route", id: ids.route } },
			api: `/v1/routes/${ids.route}/canvas-items`,
		},
		// reads no project data; any signed-in caller gets it, like public-settings
		{ tool: "get_block_schemas", args: {}, api: "/public-settings" },
		{
			tool: "get_test_runs",
			args: { testSuiteId: ids.testSuite },
			api: `/v1/${p}/test-suites/route/${ids.route}/runs`,
		},
		{ tool: "list_packages", args: { projectId: p }, api: `/v1/projects/${p}/settings/packages` },
		{
			tool: "list_recordings",
			args: { projectId: p, kind: "route", targetId: ids.route },
			api: `/v1/${p}/recordings/route/${ids.route}/runs`,
		},
		{
			tool: "get_recording",
			args: { projectId: p, kind: "route", targetId: ids.route, runId: NO_RUN },
			api: `/v1/${p}/recordings/route/${ids.route}/runs/${NO_RUN}`,
			deniedOnly: true,
		},
	];
}
