import { type ModelMessage, type Tool, tool } from "ai";
import { z } from "zod";
import { type AdminFetch, adminApi } from "../mcp/adminApi";
import { canvasTools } from "../mcp/canvasTools";
import { docsTools } from "../mcp/docsTools";
import { projectTools } from "../mcp/projectTools";
import { routeTools } from "../mcp/routeTools";
import { testSuiteTools } from "../mcp/testSuiteTools";
import { lenient, type McpTool, readTools } from "../mcp/tools";
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
	"get_test_suite",
	"run_test_suite",
	"get_system_logs",
	"get_recording",
	"list_test_suites",
	"get_test_runs",
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

export type Mode = "manual" | "auto" | "plan";
export const MODES: Mode[] = ["manual", "auto", "plan"];

/** Reads never ask: the agent's own list/get/meta tools, and MCP tools marked read-only (unmarked = read, as in mcp/index.ts). */
export const isRead = (name: string) => {
	if (["list", "get", "list_advanced_tools", "load_tools"].includes(name)) return true;
	const t = ALL.find((x) => x.name === name);
	return !!t && t.annotations?.readOnlyHint !== false;
};

const AGENT_TITLES: Record<string, string> = {
	list: "List resources",
	get: "Get resource",
	list_advanced_tools: "List advanced tools",
	load_tools: "Load tools",
};

/** The human name of a tool, for chat rows and the approval bar. */
export const titleOf = (name: string) =>
	AGENT_TITLES[name] ??
	ALL.find((t) => t.name === name)?.title ??
	name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Deletes ask in every mode and are never approved for the whole session. */
export const isDelete = (name: string) => /^(delete|remove)_/.test(name);

/**
 * The one ask rule. Deletes always ask; reads never do. Other calls ask in
 * manual (and plan, where they are not active anyway) but not in auto, so
 * call_route and run_test_suite run unasked in auto despite destructiveHint.
 */
export const needsApproval = (mode: Mode, name: string) =>
	isDelete(name) || (!isRead(name) && mode !== "auto");

/** Calls one MCP tool by name as the `auth` user, its input checked like the agent's. */
export const mcpCall =
	(fetcher: AdminFetch, auth: Record<string, string>) =>
	(name: string, args: unknown, signal?: AbortSignal): Promise<any> => {
		const t = ALL.find((x) => x.name === name);
		if (!t) throw new Error(`No tool named ${name}`);
		return t.call(adminApi(fetcher, auth, t.role, signal), z.object(lenient(t.input)).parse(args));
	};

/**
 * The agent's tools, all acting as the PAT's user through the admin API.
 * `active()` is what the next step may call: the core plus whatever load_tools added.
 * `loaded` must outlive one message: the history still says a tool was loaded,
 * so a fresh set per turn left the model calling a tool it could no longer reach (#672).
 */
export function agentTools(
	fetcher: AdminFetch,
	auth: Record<string, string>,
	projectId: string,
	loaded = new Set<string>(),
) {
	const run = mcpCall(fetcher, auth);
	/** Adds an advanced tool to the loaded set; false for a name that is not one. */
	const load = (name: string) => {
		if (!ADVANCED.some((t) => t.name === name)) return false;
		loaded.add(name);
		return true;
	};
	const wrap = (t: McpTool): Tool =>
		tool({
			title: t.title,
			description: t.description,
			inputSchema: z.object(lenient(t.input)),
			execute: (args, { abortSignal }) =>
				t.call(adminApi(fetcher, auth, t.role, abortSignal), args),
		});
	const tools: Record<string, Tool> = Object.fromEntries(
		ALL.filter((t) => !COVERED.has(t.name)).map((t) => [t.name, wrap(t)]),
	);

	tools.list = tool({
		title: AGENT_TITLES.list,
		description: `List several resource types of this project in one call: ${Object.keys(LIST_TYPES).join(", ")}.`,
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
		title: AGENT_TITLES.get,
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
		title: AGENT_TITLES.list_advanced_tools,
		description:
			"More tools (deletes, members, packages, integrations, recordings list, …) with one line each. Load them with load_tools.",
		inputSchema: z.object({}),
		execute: async () => ADVANCED.map((t) => `${t.name}: ${t.description.split(". ")[0]}`),
	});
	tools.load_tools = tool({
		title: AGENT_TITLES.load_tools,
		description:
			"Make advanced tools callable from your next step. Names from list_advanced_tools.",
		inputSchema: z.object({ names: z.array(z.string()).min(1) }),
		execute: async ({ names }) => {
			const known = names.filter(load);
			return { loaded: known, unknown: names.filter((n) => !known.includes(n)) };
		},
	});
	return { tools, active: () => [...CORE, ...loaded], load };
}

/** Up to 5 tool names that share a word with `name` (read_route ~ get_route), for the unknown-tool error. */
export function closeMatches(name: string) {
	const words = name.split("_").filter((w) => w.length > 2);
	return [...CORE, ...ADVANCED.map((t) => t.name)]
		.filter((n) => words.some((w) => n.split("_").includes(w)))
		.slice(0, 5);
}

/**
 * The tools added in a stored conversation: a web run is one job
 * per message or approval, so the set the CLI keeps in memory (#672) is
 * rebuilt from the saved calls: load_tools names, and advanced tools the model
 * called directly (auto-loaded, #699). Unknown names are dropped, as load_tools does.
 */
export function loadedTools(history: ModelMessage[]) {
	const loaded = new Set<string>();
	for (const m of history) {
		if (m.role !== "assistant" || typeof m.content === "string") continue;
		for (const p of m.content) {
			if (p.type !== "tool-call") continue;
			if (p.toolName !== "load_tools") {
				if (ADVANCED.some((t) => t.name === p.toolName)) loaded.add(p.toolName);
				continue;
			}
			const names = (p.input as { names?: unknown })?.names;
			if (!Array.isArray(names)) continue;
			for (const n of names) if (ADVANCED.some((t) => t.name === n)) loaded.add(n);
		}
	}
	return loaded;
}
