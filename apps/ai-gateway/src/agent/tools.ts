import { type Tool, tool } from "ai";
import { z } from "zod";
import { type AdminFetch, adminApi } from "../mcp/adminApi";
import { canvasTools } from "../mcp/canvasTools";
import { docsTools } from "../mcp/docsTools";
import { projectTools } from "../mcp/projectTools";
import { routeTools } from "../mcp/routeTools";
import { testSuiteTools } from "../mcp/testSuiteTools";
import { type McpTool, readTools } from "../mcp/tools";
import { writeTools } from "../mcp/writeTools";

const ALL: McpTool[] = [
	...readTools,
	...writeTools,
	...routeTools,
	...canvasTools,
	...projectTools,
	...testSuiteTools,
	...docsTools,
];

/** What `list` reads: each one only needs the project id. */
export const LIST_TYPES = {
	routes: "list_routes",
	workflows: "list_workflows",
	triggers: "list_triggers",
	custom_blocks: "list_custom_blocks",
	middlewares: "list_middlewares",
	integrations: "list_integrations",
	app_config: "list_app_config",
} as const;

/** What `get` reads, and the id argument each tool takes. */
export const GET_TYPES = {
	route: ["get_route", "routeId"],
	workflow: ["get_workflow", "workflowId"],
	trigger: ["get_trigger", "triggerId"],
	custom_block: ["get_custom_block", "customBlockId"],
	middleware: ["get_middleware", "middlewareId"],
	test_suite: ["get_test_suite", "testSuiteId"],
	integration: ["get_integration", "integrationId"],
	app_config: ["get_app_config", "appConfigId"],
} as const;

/** Wrapped as-is and always on. `list` and `get` stand in for the list_* / get_* they cover. */
const CORE_MCP = [
	"save_route",
	"save_workflow",
	"save_custom_block",
	"save_trigger",
	"get_canvas",
	"edit_canvas",
	"get_block_schemas",
	"call_route",
	"save_test_suite",
	"run_test_suite",
	"get_system_logs",
	"get_recording",
	"search_docs",
	"read_doc",
];
const COVERED = new Set<string>([
	...Object.values(LIST_TYPES),
	...Object.values(GET_TYPES).map(([n]) => n),
]);
/** Everything else loads on demand through load_tools. */
export const ADVANCED = ALL.filter((t) => !CORE_MCP.includes(t.name) && !COVERED.has(t.name));

export const CORE = [...CORE_MCP, "list", "get", "list_advanced_tools", "load_tools"];

/** Calls one MCP tool by name as the `auth` user, its input checked like the agent's. */
export const mcpCall =
	(fetcher: AdminFetch, auth: Record<string, string>) =>
	(name: string, args: unknown, signal?: AbortSignal): Promise<any> => {
		const t = ALL.find((x) => x.name === name);
		if (!t) throw new Error(`No tool named ${name}`);
		return t.call(adminApi(fetcher, auth, t.role, signal), z.object(t.input).parse(args));
	};

/**
 * The agent's tools, all acting as the PAT's user through the admin API.
 * `active()` is what the next step may call: the core plus whatever load_tools added.
 */
export function agentTools(fetcher: AdminFetch, auth: Record<string, string>, projectId: string) {
	const run = mcpCall(fetcher, auth);
	const wrap = (t: McpTool): Tool =>
		tool({
			description: t.description,
			inputSchema: z.object(t.input),
			execute: (args, { abortSignal }) =>
				t.call(adminApi(fetcher, auth, t.role, abortSignal), args),
		});
	const loaded = new Set<string>();
	const tools: Record<string, Tool> = Object.fromEntries(
		ALL.filter((t) => !COVERED.has(t.name)).map((t) => [t.name, wrap(t)]),
	);

	tools.list = tool({
		description: `List several resource types of this project in one call: ${Object.keys(LIST_TYPES).join(", ")}. Test suites: load list_test_suites.`,
		inputSchema: z.object({
			types: z.array(z.enum(Object.keys(LIST_TYPES) as [keyof typeof LIST_TYPES])).min(1),
		}),
		execute: async ({ types }, { abortSignal }) =>
			Object.fromEntries(
				await Promise.all(
					types.map(async (type) => [
						type,
						await run(LIST_TYPES[type], { projectId }, abortSignal).catch((e: Error) => ({
							error: e.message,
						})),
					]),
				),
			),
	});
	tools.get = tool({
		description: `Read one resource by id: ${Object.keys(GET_TYPES).join(", ")}. Canvases come from get_canvas.`,
		inputSchema: z.object({
			type: z.enum(Object.keys(GET_TYPES) as [keyof typeof GET_TYPES]),
			id: z.string(),
		}),
		execute: ({ type, id }, { abortSignal }) => {
			const [name, key] = GET_TYPES[type];
			return run(name, { projectId, [key]: type === "app_config" ? Number(id) : id }, abortSignal);
		},
	});
	tools.list_advanced_tools = tool({
		description:
			"More tools (deletes, members, packages, integrations, recordings list, …) with one line each. Load them with load_tools.",
		inputSchema: z.object({}),
		execute: async () => ADVANCED.map((t) => `${t.name}: ${t.description.split(". ")[0]}`),
	});
	tools.load_tools = tool({
		description:
			"Make advanced tools callable from your next step. Names from list_advanced_tools.",
		inputSchema: z.object({ names: z.array(z.string()).min(1) }),
		execute: async ({ names }) => {
			const known = names.filter((n) => ADVANCED.some((t) => t.name === n));
			for (const n of known) loaded.add(n);
			return { loaded: known, unknown: names.filter((n) => !known.includes(n)) };
		},
	});
	return { tools, active: () => [...CORE, ...loaded] };
}
